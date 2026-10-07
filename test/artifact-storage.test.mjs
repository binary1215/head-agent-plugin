import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteArtifact, atomicCreateArtifact } from "../scripts/lib/artifact-storage.mjs";

test("atomic publication preserves the existing winner on exclusive retry and cleans failed staging", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "head-storage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "record.json");
  atomicCreateArtifact(file, "original");
  assert.throws(() => atomicCreateArtifact(file, "divergent"), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(root), ["record.json"]);
  atomicWriteArtifact(file, "next");
  assert.equal(fs.readFileSync(file, "utf8"), "next");
  const blocked = path.join(root, "directory"); fs.mkdirSync(blocked);
  assert.throws(() => atomicWriteArtifact(blocked, "must not publish"));
  assert.deepEqual(fs.readdirSync(root).sort(), ["directory", "record.json"]);
});

test("Windows rename retry is finite and never overwrites a changed target", { skip: process.platform !== "win32" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "head-storage-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "record.json"), rename = fs.renameSync, lstat = fs.lstatSync;
  const denied = () => Object.assign(new Error("temporary sharing denial"), { code: "EPERM" });
  fs.writeFileSync(file, "original");
  try {
    let calls = 0;
    fs.renameSync = (...args) => { if (++calls === 1) throw denied(); return rename(...args); };
    atomicWriteArtifact(file, "next");
    assert.equal(calls, 2); assert.equal(fs.readFileSync(file, "utf8"), "next");
    calls = 0;
    fs.renameSync = () => { calls += 1; throw denied(); };
    assert.throws(() => atomicWriteArtifact(file, "unpublished"), { code: "EPERM" });
    assert.equal(calls, 5); assert.equal(fs.readFileSync(file, "utf8"), "next");
    calls = 0;
    fs.renameSync = () => { calls += 1; fs.writeFileSync(file, "concurrent user edit"); throw denied(); };
    assert.throws(() => atomicWriteArtifact(file, "must not overwrite"), { code: "EPERM" });
    assert.equal(calls, 1); assert.equal(fs.readFileSync(file, "utf8"), "concurrent user edit");
    assert.deepEqual(fs.readdirSync(root), ["record.json"]);
    calls = 0;
    let inspectionBlocked = false;
    fs.lstatSync = (target, ...args) => {
      if (inspectionBlocked && target === file) throw Object.assign(new Error("cannot inspect target"), { code: "EACCES" });
      return lstat(target, ...args);
    };
    fs.renameSync = () => { calls += 1; inspectionBlocked = true; throw denied(); };
    assert.throws(() => atomicWriteArtifact(file, "unknown comparison cannot retry"), error => error.code === "EPERM" && error.retryInspection.code === "EACCES");
    assert.equal(calls, 1); assert.equal(fs.readFileSync(file, "utf8"), "concurrent user edit");
    fs.lstatSync = lstat;
    assert.deepEqual(fs.readdirSync(root), ["record.json"]);
    calls = 0;
    fs.renameSync = (source) => { calls += 1; fs.writeFileSync(source, "changed staging"); throw denied(); };
    assert.throws(() => atomicWriteArtifact(file, "must remain unpublished"), error => error.code === "EPERM" && error.stagingCleanup.code === "ARTIFACT_STAGING_CHANGED");
    assert.equal(calls, 1); assert.equal(fs.readFileSync(file, "utf8"), "concurrent user edit");
    const preserved = fs.readdirSync(root).find(name => name.endsWith(".tmp"));
    assert.equal(fs.readFileSync(path.join(root, preserved), "utf8"), "changed staging");
  } finally { fs.renameSync = rename; fs.lstatSync = lstat; }
});
