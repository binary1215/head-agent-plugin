import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as facade from "../scripts/lib/product-operating-loop.mjs";
import * as projection from "../scripts/lib/product-operating-projection.mjs";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";

const names = ["PRODUCT_OPERATING_LOOP_VERSION", "PRODUCT_HYPOTHESIS_VERSION", "productOperatingCanonicalJson", "productOperatingDigest",
  "verifyProductSignal", "verifyProductHypothesis", "verifyProductFeatureCandidate", "verifyProductInitiativeCandidate", "verifyProductInitiativeReviewDecision",
  "verifyReviewedProductInitiative", "verifyOutcomeObservation", "verifyProductOperatingProjectionInput", "loadProductOperatingProjection",
  "recordProductSignal", "recordProductHypothesis", "proposeProductInitiative", "reviewProductInitiative", "observeProductOutcome", "inspectProductOperatingLoop", "buildHeadContinuitySnapshot"];
test("the existing twenty-name facade keeps single reader bindings, without leaking internal helpers", () => {
  assert.deepEqual(Object.keys(facade).sort(), names.sort());
  for (const name of names.filter(name => Object.hasOwn(projection, name))) assert.equal(facade[name], projection[name], name);
  const source = fs.readFileSync(new URL("../scripts/lib/product-operating-projection.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:from\s*|import\s*\()["']\.\/(?:product-operating-loop|world-model|change-set|execution-lineage)\.mjs/u);
  for (const name of ["world-model", "temporal-provenance"]) {
    const consumer = fs.readFileSync(new URL(`../scripts/lib/${name}.mjs`, import.meta.url), "utf8");
    assert.match(consumer, /from "\.\/product-operating-projection\.mjs"/u);
    assert.doesNotMatch(consumer, /from "\.\/product-operating-loop\.mjs"/u);
  }
});
test("projection loading and identity verification perform no publication, repair or readiness writes", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-operating-reader-")));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(root).startsWith("head-operating-reader-")); fs.rmSync(root, { recursive: true, force: true }); });
  initializeProject({ root, pluginRoot: path.resolve(import.meta.dirname, ".."), runtimes: ["codex"] });
  const projectId = inspectProject(root).project.projectId;
  const writes = ["writeFileSync", "appendFileSync", "renameSync", "mkdirSync", "unlinkSync", "rmSync"].map(name => [name, fs[name]]);
  let value;
  try {
    for (const [name] of writes) fs[name] = () => assert.fail(`Read attempted ${name}`);
    value = projection.loadProductOperatingProjection({ projectRoot: root, projectId });
    assert.equal(projection.verifyProductOperatingProjectionInput(value), value);
    assert.deepEqual(facade.loadProductOperatingProjection({ projectRoot: root, projectId }), value);
    assert.equal(value.instructionAuthority, false); assert.equal(value.promotionAuthority, false);
  } finally { for (const [name, method] of writes) fs[name] = method; }
  assert.throws(() => projection.verifyProductOperatingProjectionInput({ ...value, projectId: "changed" }), { code: "PRODUCT_OPERATING_PROJECTION_DIGEST_MISMATCH" });
});
