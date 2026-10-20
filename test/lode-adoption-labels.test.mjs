import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withProjectMutation } from "../scripts/lib/project-mutation-lock.mjs";
import { compileContext, readContextCapsule } from "../scripts/lib/context-compiler.mjs";
import { catalogTools } from "../scripts/mcp-server.mjs";

const source = path.resolve(import.meta.dirname, "..");
test("the twelve accepted current display labels use Lode and keep compatibility error codes", () => {
  const files = ["scripts/lode.mjs", "scripts/mcp-server.mjs", ...["distribution-lifecycle", "compaction-recovery", "context-compiler", "execution-lineage", "project-mutation-lock", "runtime-invocation-lifecycle", "session-routing", "world-model"].map(name => `scripts/lib/${name}.mjs`)];
  const text = files.map(file => fs.readFileSync(path.join(source, file), "utf8")).join("\n");
  assert.doesNotMatch(text, /HEAD Agent Core/);
  assert.equal((text.match(/Lode Agent Core/g) || []).length, 12);
  assert.match(text, /HEAD_DISTRIBUTION_INSTALL_ROOT_CONFLICT/);
  assert.match(text, /HEAD_DISTRIBUTION_NOT_INSTALLED/);
  assert.equal(catalogTools.find(tool => tool.name === "lode_core_contract").description, "Read the active Lode Agent Core roles, runtimes, and capability boundary.");
});

test("not-initialized paths preserve exact error identity with the corrected display name", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lode-label-errors-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => withProjectMutation({ root, scope: "fixture" }, () => assert.fail("not reached")), {
    code: "NOT_INITIALIZED", message: "Lode Agent Core is not initialized.",
  });
  assert.throws(() => readContextCapsule({ root, capsuleId: `capsule-${"a".repeat(24)}` }), {
    code: "NOT_INITIALIZED", message: "Lode Agent Core is not initialized.",
  });
  assert.throws(() => compileContext({ root, task: "synthetic fixture", budget: 32768, persist: false }), {
    code: "PROJECT_NOT_READY", message: "Project must be ready to compile context; current status: not_initialized.",
  });
});
