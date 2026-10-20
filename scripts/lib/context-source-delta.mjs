import crypto from "node:crypto";
import path from "node:path";
import { analyzeSourceFile, languageForSource, SOURCE_ANALYSIS_VERSION } from "./source-analysis.mjs";

const sha = text => crypto.createHash("sha256").update(text).digest("hex");

function lineComparison(before, after) {
  const a = before.split("\n"), b = after.split("\n"); let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const excerpt = lines => {
    const from = Math.max(0, start - 3), to = Math.min(lines.length, lines.length - end + 3), selected = lines.slice(from, to);
    // Bounded display only. Excluded lines remain in the exact original, not
    // a claim that other changes are irrelevant or the task is sufficient.
    const included = selected.slice(0, 160), text = included.join("\n");
    return { startLine: from + 1, endLine: from + included.length, text: text.slice(0, 32 * 1024),
      omittedLines: Math.max(0, selected.length - included.length), textTruncated: text.length > 32 * 1024 };
  };
  return { kind: "bounded-line-comparison-not-semantic-diff", changed: before !== after, before: excerpt(a), after: excerpt(b), commonPrefixLines: start, commonSuffixLines: end };
}

// A bounded lexical check, not a semantic equivalence or AST claim. Preserve
// every literal and newline. Unsupported slash/template syntax reduces precision.
function commentStripped(text, language, structural = false) {
  let output = "", mode = "code", quote = "", escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    const lineTerminator = c === "\n" || c === "\r" || language !== "python" && (c === "\u2028" || c === "\u2029");
    if (mode === "line") { if (lineTerminator) { output += c; mode = "code"; } continue; }
    if (mode === "block") { if (c === "*" && next === "/") { mode = "code"; i++; } else if (lineTerminator) output += c; continue; }
    if (mode === "string") {
      output += structural && c !== "\n" ? " " : c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) mode = "code";
      continue;
    }
    if (mode === "triple") { output += structural && c !== "\n" ? " " : c; if (text.slice(i, i + 3) === quote.repeat(3)) { output += structural ? "  " : quote.repeat(2); i += 2; mode = "code"; } continue; }
    if (language === "python" && c === "#" || language !== "python" && c === "/" && next === "/") { mode = "line"; if (c === "/") i++; continue; }
    // A block comment separates tokens; deleting it could turn typeof x into
    // typeofx, or + + into ++. Its line terminators also affect JS ASI.
    if (language !== "python" && c === "/" && next === "*") { output += " "; mode = "block"; i++; continue; }
    if (language !== "python" && (c === "/" || c === "`")) return null;
    if (c === "'" || c === '"') {
      quote = c;
      if (language === "python" && text.slice(i, i + 3) === c.repeat(3)) { mode = "triple"; output += structural ? "   " : c.repeat(3); i += 2; continue; }
      mode = "string";
    }
    output += structural && mode === "string" ? " " : c;
  }
  return mode === "code" || mode === "line" ? output : null;
}

function boundedRangeIsolated(text, language, symbol) {
  if (language === "python") {
    const lines = text.split("\n"), indent = (lines[0].match(/^\s*/) || [""])[0].length;
    if (!lines[0].trimEnd().endsWith(":")) return false;
    return !lines.slice(1).some(line => /^\s*#/.test(line) && (line.match(/^\s*/) || [""])[0].length <= indent);
  }
  if (!["function", "class"].includes(symbol.kind)) return false;
  const structure = commentStripped(text, language, true);
  if (structure === null || !/^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\b/.test(structure)) return false;
  const open = structure.indexOf("{"); if (open < 0 || structure.slice(0, open).includes("=")) return false;
  let parens = 0; for (const c of structure.slice(0, open)) { if (c === "(") parens++; if (c === ")") parens--; } if (parens !== 0) return false;
  let depth = 0;
  for (let i = open; i < structure.length; i++) {
    if (structure[i] === "{") depth++;
    else if (structure[i] === "}" && --depth === 0) return /^\s*;?\s*$/.test(structure.slice(i + 1));
  }
  return false;
}

function declarations(version) {
  const language = languageForSource(path.extname(version.path), path.basename(version.path));
  if (!["javascript", "typescript", "python"].includes(language)) return { status: "unsupported-language", items: [] };
  // Obtain boundaries independently for this exact version, never from today's
  // SymbolRevision or from a line number in a different revision.
  const symbols = analyzeSourceFile(version.text, language, path.basename(version.path)).symbols;
  const lines = version.text.split("\n"), safeSyntax = commentStripped(version.text, language) !== null;
  const items = symbols.map(symbol => {
    const sameLine = symbols.some(other => other !== symbol && (other.line === symbol.line || other.endLine === symbol.line && other.scopePath === symbol.scopePath));
    let valid = safeSyntax && !symbol.identityAmbiguous && !sameLine && Number.isInteger(symbol.line) && Number.isInteger(symbol.endLine)
      && symbol.line > 0 && symbol.endLine >= symbol.line && symbol.endLine <= lines.length;
    if (valid) valid = boundedRangeIsolated(lines.slice(symbol.line - 1, symbol.endLine).join("\n"), language, symbol);
    const text = valid ? lines.slice(symbol.line - 1, symbol.endLine).join("\n") : null;
    return { name: symbol.name, qualifiedName: symbol.qualifiedName, kind: symbol.kind, signature: symbol.signature,
      line: symbol.line, endLine: symbol.endLine, rangePrecision: valid ? "independent-bounded-declaration-lines" : "ambiguous-or-unsupported-boundary",
      text, digest: text === null ? null : sha(text), code: text === null ? null : commentStripped(text, language) };
  });
  return { status: "bounded-analysis-not-full-parser", language, analysisVersion: SOURCE_ANALYSIS_VERSION, potentiallyTruncated: symbols.length >= 200, items };
}

// UI/query-private observation. A comparison key is NOT a canonical Symbol ID.
export function compareExactSourceVersions(before, after, projectId) {
  const descriptor = version => version ? { path: version.path, digest: version.digest, basis: version.basis, revisionId: version.revisionId || null } : null;
  const result = { before: descriptor(before), after: descriptor(after), identity: "exact-file-bytes-not-decision-causality", symbols: [] };
  if (!before || !after) return { ...result, status: "unknown", reasonCode: "EXACT_SOURCE_PAIR_UNAVAILABLE" };
  if (before.projectId !== projectId || after.projectId !== projectId || before.path !== after.path) return { ...result, status: "unknown", reasonCode: "SOURCE_PAIR_IDENTITY_MISMATCH" };
  for (const version of [before, after]) if (typeof version.text !== "string" || sha(version.text) !== version.digest) return { ...result, status: "unknown", reasonCode: "SOURCE_PAIR_DIGEST_MISMATCH" };
  const previous = declarations(before), current = declarations(after);
  result.fileBytes = before.digest === after.digest ? "unchanged" : "changed";
  result.diff = lineComparison(before.text, after.text);
  result.analysis = { before: { ...previous, items: undefined }, after: { ...current, items: undefined } };
  const key = symbol => JSON.stringify([symbol.kind, symbol.qualifiedName]);
  const old = new Map(previous.items.map(s => [key(s), s])), next = new Map(current.items.map(s => [key(s), s]));
  result.symbols = [...new Set([...old.keys(), ...next.keys()])].map(comparisonKey => {
    const a = old.get(comparisonKey), b = next.get(comparisonKey);
    let observation = "unknown-boundary";
    if (!a || !b) observation = "unmatched-declaration-not-proven-rename-or-continuity";
    else if (a.digest && b.digest) observation = a.digest === b.digest ? "declaration-bytes-unchanged"
      : a.code !== null && a.code === b.code ? "comment-text-only-difference"
        : a.text.trimEnd() === b.text.trimEnd() ? "trailing-layout-only-difference" : "declaration-bytes-changed";
    const view = symbol => symbol ? { name: symbol.name, qualifiedName: symbol.qualifiedName, line: symbol.line, endLine: symbol.endLine,
      digest: symbol.digest, rangePrecision: symbol.rangePrecision } : null;
    return { comparisonKey, identity: "unique-name-and-scope-comparison-not-canonical-lineage", observation,
      beforeDeclarationCount: previous.items.filter(item => key(item) === comparisonKey).length,
      afterDeclarationCount: current.items.filter(item => key(item) === comparisonKey).length,
      before: view(a), after: view(b), locationChanged: Boolean(a && b && (a.line !== b.line || a.endLine !== b.endLine)),
      behaviorChanged: "not-determined", decisionCause: "not-inferred" };
  });
  return { ...result, status: "observed", semanticEquivalence: "not-determined", renameContinuity: "not-inferred" };
}
