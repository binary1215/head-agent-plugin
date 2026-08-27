import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const docsDir = path.join(root, "docs");
const koDir = path.join(docsDir, "ko");

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function fencedBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);
  let fence = null;
  let body = [];
  for (const line of lines) {
    const match = line.match(/^\s*(```+|~~~+)/);
    if (!fence && match) {
      fence = match[1][0];
      body = [line];
    } else if (fence) {
      body.push(line);
      if (match && match[1][0] === fence) {
        blocks.push(body.join("\n"));
        fence = null;
        body = [];
      }
    }
  }
  assert.equal(fence, null, "unclosed Markdown fence");
  return blocks;
}

function inlineCode(markdown) {
  const outsideFences = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) outsideFences.push(line);
  }
  const tokens = [];
  for (const match of outsideFences.join("\n").matchAll(/(`+)([^`\n]+)\1/g)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function links(markdown) {
  const results = [];
  const expression = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(expression)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    target = target.split(/\s+["']/)[0];
    results.push(target);
  }
  return results;
}

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target);
}

function withoutFragment(target) {
  return decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
}

function assertLinksExist(filePath, markdown) {
  for (const target of links(markdown)) {
    if (isExternal(target) || !withoutFragment(target)) continue;
    const resolved = path.resolve(path.dirname(filePath), withoutFragment(target));
    assert.ok(fs.existsSync(resolved), `${path.relative(root, filePath)} has broken link: ${target}`);
  }
}

function expectedKoreanTarget(sourcePath, target) {
  if (isExternal(target) || !withoutFragment(target)) return target;
  const suffix = target.slice(withoutFragment(target).length);
  const sourceResolved = path.resolve(path.dirname(sourcePath), withoutFragment(target));
  const relativeToDocs = path.relative(docsDir, sourceResolved);
  const staysInDocs = relativeToDocs !== ".." && !relativeToDocs.startsWith(`..${path.sep}`);
  if (staysInDocs && fs.existsSync(path.join(koDir, relativeToDocs))) {
    return path.join(koDir, relativeToDocs) + suffix;
  }
  return sourceResolved + suffix;
}

const publicIndex = fs.readFileSync(path.join(docsDir, "README.md"), "utf8");
const indexedEnglishFiles = links(publicIndex)
  .map(withoutFragment)
  .filter((target) => /^[^/\\]+\.md$/i.test(target));
const englishFiles = [...new Set(["README.md", ...indexedEnglishFiles])].sort();
for (const name of englishFiles) {
  assert.ok(fs.existsSync(path.join(docsDir, name)), `public documentation index points to missing file: ${name}`);
}
const koreanFiles = markdownFiles(koDir);
assert.deepEqual(koreanFiles, englishFiles, "docs/ko must contain one exact-basename counterpart for every public docs/*.md file");

for (const name of englishFiles) {
  const sourcePath = path.join(docsDir, name);
  const koreanPath = path.join(koDir, name);
  const source = fs.readFileSync(sourcePath, "utf8");
  const korean = fs.readFileSync(koreanPath, "utf8");
  const koreanComparable = korean.replace(/^>.*\(\.\.\/[^)]+\).*\r?\n(?:\r?\n)?/m, "");

  assertLinksExist(sourcePath, source);
  assertLinksExist(koreanPath, korean);
  assert.match(korean, new RegExp(`\\(\\.\\./${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`), `${name} must link to its English source`);

  const sourceFences = fencedBlocks(source);
  const koreanFences = fencedBlocks(korean);
  assert.deepEqual(koreanFences, sourceFences, `${name} must preserve fenced code blocks byte-for-byte apart from line endings`);
  assert.deepEqual(inlineCode(koreanComparable).sort(), inlineCode(source).sort(), `${name} must preserve the inline code token multiset`);

  if (name !== "HEAD-Agent_GraphDB_Brief_v4.md") {
    const prose = korean.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
    assert.ok((prose.match(/[가-힣]/g) ?? []).length >= 40, `${name} does not contain enough Korean prose`);
  }

  const sourceTargets = links(source).filter((target, index) => !(name === "README.md" && index === 0 && target === "ko/README.md"));
  const koreanTargets = links(korean).filter((target, index) => !(index === 0 && target === `../${name}`));
  assert.equal(koreanTargets.length, sourceTargets.length, `${name} must preserve the source link set`);
  for (let index = 0; index < sourceTargets.length; index += 1) {
    const expected = expectedKoreanTarget(sourcePath, sourceTargets[index]);
    const actualTarget = koreanTargets[index];
    if (isExternal(sourceTargets[index])) {
      assert.equal(actualTarget, expected, `${name} changed external link ${sourceTargets[index]}`);
    } else {
      const actual = path.resolve(path.dirname(koreanPath), withoutFragment(actualTarget));
      assert.equal(actual, withoutFragment(expected), `${name} changed the destination of ${sourceTargets[index]}`);
    }
  }
}

const publicMarkdown = [
  fs.readFileSync(path.join(root, "README.md"), "utf8"),
  fs.readFileSync(path.join(root, "README.ko.md"), "utf8"),
  ...englishFiles.map((name) => fs.readFileSync(path.join(docsDir, name), "utf8")),
  ...koreanFiles.map((name) => fs.readFileSync(path.join(koDir, name), "utf8")),
].join("\n");
assert.doesNotMatch(publicMarkdown, /neo\s*pick/i, "public documentation must not contain NeoPick material");

for (const readmeName of ["README.md", "README.ko.md"]) {
  const readme = fs.readFileSync(path.join(root, readmeName), "utf8");
  assert.match(readme, /docs\/README\.md/, `${readmeName} must link the English documentation index`);
  assert.match(readme, /docs\/ko\/README\.md/, `${readmeName} must link the Korean documentation index`);
}

const koreanReadme = fs.readFileSync(path.join(root, "README.ko.md"), "utf8");
const englishReadme = fs.readFileSync(path.join(root, "README.md"), "utf8");
assert.deepEqual(
  links(koreanReadme).filter((target) => /^https?:/i.test(target)).sort(),
  links(englishReadme).filter((target) => /^https?:/i.test(target)).sort(),
  "README language variants must preserve the same external link set",
);
for (const target of links(koreanReadme).filter((entry) => entry.startsWith("docs/"))) {
  assert.ok(target === "docs/README.md" || target.startsWith("docs/ko/"), `README.ko.md routes a detailed document link to English: ${target}`);
}

const contextCompiler = fs.readFileSync(path.join(docsDir, "context-compiler.md"), "utf8");
assert.match(contextCompiler, /32K.*64K.*128K.*256K.*512K/s, "Context Compiler docs must describe the current fixed budget tiers");
assert.match(contextCompiler, /current Compiler rejects arbitrary 4,000-token input/i, "Context Compiler docs must identify 4,000 tokens as a rejected historical budget");
assert.match(fs.readFileSync(path.join(docsDir, "product-operating-loop.md"), "utf8"), /protocol `0\.2\.0`/i);
assert.match(fs.readFileSync(path.join(docsDir, "onboarding.md"), "utf8"), /Claude Code, Codex, OpenCode/);

console.log(JSON.stringify({
  status: "ok",
  englishDocuments: englishFiles.length,
  koreanDocuments: koreanFiles.length,
  publicIndex: "docs/README.md",
}));
