export const SOURCE_ANALYSIS_VERSION = "0.1.0";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lineAt(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) if (text.charCodeAt(position) === 10) line += 1;
  return line;
}

export function languageForSource(extension, base) {
  if (base === "Dockerfile") return "dockerfile";
  const languages = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".ts": "typescript",
    ".tsx": "typescript", ".mts": "typescript", ".py": "python", ".go": "go", ".rs": "rust",
    ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".cs": "csharp", ".rb": "ruby",
    ".php": "php", ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml", ".html": "html", ".css": "css", ".sql": "sql", ".ps1": "powershell",
    ".sh": "shell", ".vue": "vue", ".svelte": "svelte",
  };
  return languages[extension] || extension.slice(1) || "text";
}

export function classifySourcePath(relative, extension) {
  const segments = relative.toLowerCase().split("/");
  const base = segments.at(-1);
  if (segments.some((item) => item === "test" || item === "tests" || item === "__tests__") || /(?:^|[._-])(test|spec)\./.test(base)) return "test";
  if (extension === ".md" || segments.includes("docs")) return "documentation";
  if ([".json", ".yaml", ".yml", ".toml"].includes(extension) || base.startsWith(".")) return "configuration";
  return "source";
}

function regexSymbols(text, expressions, maxSymbols) {
  const symbols = [];
  for (const [kind, expression] of expressions) {
    for (const match of text.matchAll(expression)) {
      symbols.push({ name: match[1], kind, line: lineAt(text, match.index || 0) });
      if (symbols.length >= maxSymbols) return symbols;
    }
  }
  return symbols.sort((left, right) => left.line - right.line || compareText(left.name, right.name));
}

export function extractSourceSymbols(text, language, { maxSymbols = 200 } = {}) {
  if (!Number.isInteger(maxSymbols) || maxSymbols < 1 || maxSymbols > 10_000) throw Object.assign(new Error("maxSymbols is invalid."), { code: "INVALID_SOURCE_SYMBOL_LIMIT" });
  if (["javascript", "typescript"].includes(language)) {
    return regexSymbols(text, [
      ["function", /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g],
      ["class", /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g],
      ["binding", /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g],
    ], maxSymbols);
  }
  if (language === "python") {
    return regexSymbols(text, [
      ["function", /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/gm],
      ["class", /^\s*class\s+([A-Za-z_][\w]*)/gm],
    ], maxSymbols);
  }
  if (language === "markdown") return regexSymbols(text, [["heading", /^#{1,6}\s+(.+?)\s*$/gm]], maxSymbols);
  return [];
}

export function extractSourceDependencies(text, language, base) {
  const dependencies = [];
  const seen = new Set();
  const add = (specifier, kind, line = 1) => {
    if (!specifier || seen.has(`${kind}:${specifier}`)) return;
    seen.add(`${kind}:${specifier}`);
    dependencies.push({ specifier, kind, line });
  };
  if (["javascript", "typescript"].includes(language)) {
    for (const match of text.matchAll(/\b(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) add(match[1], "module", lineAt(text, match.index || 0));
  } else if (language === "python") {
    for (const match of text.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm)) add(match[1], "module", lineAt(text, match.index || 0));
  }
  if (base === "package.json") {
    try {
      const parsed = JSON.parse(text);
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(parsed[section] || {})) add(name, section, 1);
      }
    } catch {}
  }
  return dependencies.sort((left, right) => compareText(left.kind, right.kind) || compareText(left.specifier, right.specifier));
}

function extractImportBindings(text, language) {
  const bindings = [];
  const add = (local, imported, specifier, namespace = false) => {
    if (local && specifier) bindings.push({ local, imported, specifier, namespace });
  };
  if (["javascript", "typescript"].includes(language)) {
    for (const match of text.matchAll(/\bimport\s+([^;\n]+?)\s+from\s+["']([^"']+)["']/g)) {
      const clause = match[1].trim();
      const specifier = match[2];
      const namespace = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (namespace) add(namespace[1], "*", specifier, true);
      const named = clause.match(/\{([^}]+)\}/);
      if (named) for (const item of named[1].split(",")) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) add(parts[1] || parts[0], parts[0], specifier);
      }
      const defaultBinding = clause.split(",")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(defaultBinding)) add(defaultBinding, "default", specifier);
    }
    for (const match of text.matchAll(/\b(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      for (const item of match[1].split(",")) {
        const parts = item.trim().split(/\s*:\s*/);
        if (parts[0]) add(parts[1] || parts[0], parts[0], match[2]);
      }
    }
    for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)) add(match[1], "*", match[2], true);
  } else if (language === "python") {
    for (const match of text.matchAll(/^\s*from\s+([.A-Za-z_][\w.]*)\s+import\s+([^#\n]+)/gm)) {
      for (const item of match[2].split(",")) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) add(parts[1] || parts[0], parts[0], match[1]);
      }
    }
    for (const match of text.matchAll(/^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_][\w]*))?/gm)) add(match[2] || match[1].split(".")[0], "*", match[1], true);
  }
  return bindings.sort((left, right) => compareText(left.local, right.local) || compareText(left.specifier, right.specifier) || compareText(left.imported, right.imported));
}

function extractCalls(text, language) {
  if (!["javascript", "typescript", "python"].includes(language)) return [];
  const excluded = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "class", "def", "with", "assert", "lambda"]);
  const calls = [];
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g)) {
    const callee = match[1];
    const prefix = text.slice(Math.max(0, (match.index || 0) - 24), match.index || 0);
    if (excluded.has(callee) || /\b(?:function|class|def|new)\s*$/.test(prefix)) continue;
    calls.push({ callee, line: lineAt(text, match.index || 0) });
  }
  return calls.sort((left, right) => left.line - right.line || compareText(left.callee, right.callee));
}

export function extractSemanticSourceFacts(text, language) {
  return {
    bindings: extractImportBindings(text, language),
    calls: extractCalls(text, language),
  };
}
