import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(pluginRoot, "skills", "head-agent-core");
const files = ["SKILL.md", "references/runtime-composition.md", "references/conversation-ux.md", "references/authority-and-roles.md"];

// This checks this Skill's inline Markdown links and ATX heading anchors, not
// model behavior or every CommonMark extension. Ignore examples in code fences.
function prose(markdown) {
  let fence = null;
  return markdown.split(/\r?\n/).filter((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return false;
    }
    return !fence;
  }).join("\n");
}

function anchors(markdown) {
  const found = new Set();
  for (const line of prose(markdown).split("\n")) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (!heading) continue;
    const base = heading[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
    let candidate = base, suffix = 0;
    while (found.has(candidate)) candidate = `${base}-${++suffix}`;
    found.add(candidate);
  }
  return found;
}

function verifyLinks(file, root) {
  const markdown = prose(fs.readFileSync(file, "utf8")).replace(/`+[^`\n]*`+/g, "");
  const checked = [];
  for (const match of markdown.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [relative, fragment] = target.split("#");
    const resolved = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file;
    const fromRoot = path.relative(root, resolved);
    assert(!fromRoot.startsWith(`..${path.sep}`) && fromRoot !== ".." && !path.isAbsolute(fromRoot), `Link escapes root: ${target}`);
    assert(fs.statSync(resolved, { throwIfNoEntry: false })?.isFile(), `Missing link file: ${target}`);
    if (fragment) assert(anchors(fs.readFileSync(resolved, "utf8")).has(decodeURIComponent(fragment)), `Missing anchor: ${target}`);
    checked.push(target);
  }
  return checked;
}

function fixture(t) {
  const parent = fs.realpathSync(process.env.HEAD_AGENT_TEST_TMP || os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "head-skill-links-"));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true }); });
  const source = path.join(root, "SKILL.md"), reference = path.join(root, "reference.md");
  fs.writeFileSync(reference, "# Follow-up handoffs\n## Follow-up handoffs\n\n```md\n## Not a heading\n```\n");
  return { root, source, reference };
}

test("HEAD Skill and changed references route to existing files and anchors", () => {
  const checked = new Map(files.map((relative) => [relative, verifyLinks(path.join(skillRoot, relative), pluginRoot)]));
  for (const target of ["references/runtime-composition.md", "references/runtime-composition.md#follow-up-handoffs", "references/conversation-ux.md"]) {
    assert(checked.get("SKILL.md").includes(target), `Missing discoverable Markdown route: ${target}`);
  }
  assert(checked.get("references/runtime-composition.md").includes("conversation-ux.md#recovery-presentation"));
});

test("link checker accepts local, same-page and duplicate-heading fragments", (t) => {
  const { root, source } = fixture(t);
  fs.writeFileSync(source, "# Local\n[one](reference.md#follow-up-handoffs)\n[two](reference.md#follow-up-handoffs-1)\n[local](#local)\n");
  assert.equal(verifyLinks(source, root).length, 3);
});

test("a missing target path fails even when the link looks plausible", (t) => {
  const { root, source } = fixture(t);
  fs.writeFileSync(source, "[handoff](missing-reference.md#follow-up-handoffs)\n");
  assert.throws(() => verifyLinks(source, root), /Missing link file/);
});

test("wrong fragments and fenced example headings do not pass as real anchors", (t) => {
  const { root, source } = fixture(t);
  for (const fragment of ["follow-up-handoff", "not-a-heading"]) {
    fs.writeFileSync(source, `[handoff](reference.md#${fragment})\n`);
    assert.throws(() => verifyLinks(source, root), /Missing anchor/);
  }
});

test("directories and escaping paths are not valid reference files", (t) => {
  const { root, source } = fixture(t);
  fs.mkdirSync(path.join(root, "directory.md"));
  fs.writeFileSync(source, "[bad](directory.md)\n");
  assert.throws(() => verifyLinks(source, root), /Missing link file/);
  fs.writeFileSync(source, "[bad](../outside.md)\n");
  assert.throws(() => verifyLinks(source, root), /Link escapes root/);
});
