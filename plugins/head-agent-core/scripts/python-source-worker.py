"""Isolated, parse-only Python source observer. Never imports project modules.

Reports lexical direct-name candidates, not dynamic Python call truth. Other
calls remain explicit unresolved observations. Input/output is one JSON frame.
"""
import ast
import hashlib
import io
import json
import sys
import tokenize

VERSION = "python-ast-direct-name-1"
MAX_FRAME = 12 * 1024 * 1024
MATCH_BINDINGS = tuple(getattr(ast, name) for name in ("MatchAs", "MatchStar") if hasattr(ast, name))
MAPPING_BINDINGS = tuple(getattr(ast, name) for name in ("MatchMapping",) if hasattr(ast, name))


def profile():
    with open(ast.__file__, "rb") as source:
        ast_digest = hashlib.sha256(source.read()).hexdigest()
    with open(tokenize.__file__, "rb") as source:
        tokenize_digest = hashlib.sha256(source.read()).hexdigest()
    return {"version": VERSION, "python": sys.version, "implementation": sys.implementation.name,
            "astDigest": ast_digest, "tokenizeDigest": tokenize_digest,
            "isolated": bool(sys.flags.isolated), "noSite": bool(sys.flags.no_site)}


def observe(item):
    text = item["text"]
    # Python source coordinates use physical LF/CRLF, not Unicode separators,
    # vertical tab or form feed inside valid string literals.
    lines = text.split("\n")
    tree = ast.parse(text, filename=item["path"], type_comments=True)
    tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))

    def position(line, byte):
        prefix = lines[line - 1].encode("utf-8")[:byte].decode("utf-8", "strict")
        return {"line": line - 1, "character": len(prefix.encode("utf-16-le")) // 2}

    def span(node):
        return {"start": position(node.lineno, node.col_offset), "end": position(node.end_lineno, node.end_col_offset)}

    def endpoint(node):
        # tokenize positions are Unicode code points, unlike AST byte offsets.
        names = [token for token in tokens if token.type == tokenize.NAME and token.string == node.name
                 and token.start[0] == node.lineno and token.start[1] >= node.col_offset]
        if not names:
            raise ValueError("declaration-name-not-found")
        token = names[0]
        def token_pos(point):
            line, column = point
            return {"line": line - 1, "character": len(lines[line - 1][:column].encode("utf-16-le")) // 2}
        return {"name": node.name, "symbolKind": "function", "declarationRange": span(node),
                "selectionRange": {"start": token_pos(token.start), "end": token_pos(token.end)}}

    functions = {}
    scopes = {}

    def inventory(node, qualified="", enclosing=None):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                key = qualified + ("." if qualified else "") + child.name
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions.setdefault(key, []).append(child)
                    scopes[id(child)] = enclosing if not isinstance(node, ast.ClassDef) else None
                inventory(child, key, child)
            else:
                inventory(child, qualified, enclosing)

    inventory(tree)
    matches = functions.get(item["symbol"], [])
    if len(matches) != 1:
        return {"path": item["path"], "symbol": item["symbol"], "pairs": [], "unresolved": [],
                "reason": "symbol-missing-or-ambiguous", "availableSymbols": sorted(functions)}
    caller = matches[0]

    def scope_nodes(scope):
        # Do not confuse bodies of other functions/classes/lambdas with this scope.
        for child in ast.iter_child_nodes(scope):
            yield child
            if not isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                yield from scope_nodes(child)

    def bindings(scope):
        definitions, rebound = {}, set()
        for child in scope_nodes(scope):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                definitions.setdefault(child.name, []).append(child)
            elif isinstance(child, ast.Name) and isinstance(child.ctx, (ast.Store, ast.Del)):
                rebound.add(child.id)
            elif isinstance(child, (ast.Import, ast.ImportFrom)):
                rebound.update(alias.asname or alias.name.split(".")[0] for alias in child.names)
            elif isinstance(child, ast.ClassDef):
                rebound.add(child.name)
            elif isinstance(child, (ast.Global, ast.Nonlocal)):
                rebound.update(child.names)
            elif isinstance(child, ast.ExceptHandler) and child.name:
                rebound.add(child.name)
            elif isinstance(child, MATCH_BINDINGS) and child.name:
                rebound.add(child.name)
            elif isinstance(child, MAPPING_BINDINGS) and child.rest:
                rebound.add(child.rest)
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = scope.args
            rebound.update(arg.arg for arg in args.posonlyargs + args.args + args.kwonlyargs)
            rebound.update(arg.arg for arg in [args.vararg, args.kwarg] if arg)
            rebound.update(parameter.name for parameter in getattr(scope, "type_params", []))
        return definitions, rebound

    local_defs, local_rebound = bindings(caller)
    module_defs, module_rebound = bindings(tree)
    nested = "." in item["symbol"]
    pairs, unresolved = [], []
    for call in (node for node in scope_nodes(caller) if isinstance(node, ast.Call)):
        callee = call.func
        target = None
        reason = "dynamic-or-attribute-call"
        if isinstance(callee, ast.Name):
            name = callee.id
            defs = local_defs.get(name, [])
            if name in local_rebound:
                reason = "local-shadowing-or-rebinding"
            elif len(defs) == 1 and not defs[0].decorator_list and defs[0] in caller.body and defs[0].end_lineno < call.lineno:
                target = defs[0]
            elif defs:
                reason = "ambiguous-or-decorated-local-definition"
            elif nested:
                reason = "enclosing-scope-not-resolved"
            elif name in module_rebound:
                reason = "module-shadowing-import-or-rebinding"
            elif len(module_defs.get(name, [])) == 1 and not module_defs[name][0].decorator_list and module_defs[name][0] in tree.body:
                target = module_defs[name][0]
            else:
                reason = "external-ambiguous-or-decorated-definition"
        if target:
            pairs.append({"from": endpoint(caller), "to": endpoint(target), "range": span(callee)})
        else:
            unresolved.append({"range": span(callee), "reason": reason})
    return {"path": item["path"], "symbol": item["symbol"], "pairs": pairs, "unresolved": unresolved,
            "reason": None if pairs else "no-supported-positive-direct-name-call"}


def main():
    frame = sys.stdin.buffer.read(MAX_FRAME + 1)
    if len(frame) > MAX_FRAME:
        raise ValueError("input-frame-limit")
    request = json.loads(frame)
    result = {"protocol": VERSION, "profile": profile()}
    if request["operation"] == "collect":
        result["results"] = []
        for item in request["sources"]:
            try:
                result["results"].append(observe(item))
            except (SyntaxError, ValueError, RecursionError) as error:
                result["results"].append({"path": item["path"], "symbol": item["symbol"], "pairs": [],
                                          "unresolved": [], "reason": "parse-unsupported", "errorType": type(error).__name__})
    elif request["operation"] != "identity":
        raise ValueError("unknown-operation")
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    if len(encoded) > 1024 * 1024:
        encoded = json.dumps({"protocol": VERSION, "profile": result["profile"], "reason": "output-frame-limit"}).encode()
    sys.stdout.buffer.write(encoded)


if __name__ == "__main__":
    main()
