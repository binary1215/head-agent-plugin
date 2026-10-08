import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteArtifact, atomicCreateArtifact } from "../scripts/lib/artifact-storage.mjs";
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "head-C-atomic-"));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^head-C-atomic-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
test("failed partial write cleans the staging inode owned before writing", (t) => {
  const directory = fixture(t), destination = path.join(directory, "record.json");
  const write = fs.writeFileSync;
  fs.writeFileSync = (target, content, options) => {
    if (typeof target === "number") {
      write(target, String(content).slice(0, 4), options);
      throw Object.assign(new Error("Partial write failure"), { code: "EIO" });
    }
    return write(target, content, options);
  };
  try { assert.throws(() => atomicCreateArtifact(destination, "complete original"), { code: "EIO" }); }
  finally { fs.writeFileSync = write; }
  assert.deepEqual(fs.readdirSync(directory), []);
});
test("a replaced staging file is preserved because its inode is not owned", (t) => {
  const directory = fixture(t), destination = path.join(directory, "record.json");
  const write = fs.writeFileSync, open = fs.openSync;
  let temporary;
  fs.openSync = (file, ...args) => { if (String(file).endsWith(".tmp")) temporary = file; return open(file, ...args); };
  fs.writeFileSync = (target, content, options) => {
    if (typeof target === "number") {
      write(target, "partial", options);
      fs.renameSync(temporary, path.join(directory, "held-owned-partial"));
      write(temporary, "replacement owned by someone else");
      throw Object.assign(new Error("Write failure after replacement"), { code: "EIO" });
    }
    return write(target, content, options);
  };
  try { assert.throws(() => atomicCreateArtifact(destination, "complete original"), (error) => error.code === "EIO" && error.stagingCleanup?.code === "ARTIFACT_STAGING_CHANGED"); }
  finally { fs.writeFileSync = write; fs.openSync = open; }
  assert.equal(fs.readFileSync(temporary, "utf8"), "replacement owned by someone else");
  assert.equal(fs.existsSync(destination), false);
});
test("failed publication preserves the original destination and removes only its owned stage", (t) => {
  const directory = fixture(t), destination = path.join(directory, "record.json");
  fs.writeFileSync(destination, "original");
  const rename = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error("Publication failure"), { code: "EIO" }); };
  try { assert.throws(() => atomicWriteArtifact(destination, "new record"), { code: "EIO" }); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readdirSync(directory), ["record.json"]);
  assert.equal(fs.readFileSync(destination, "utf8"), "original");
});
