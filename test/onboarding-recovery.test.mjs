import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { initializeOrResumeProject } from "../scripts/lib/project-bootstrap.mjs";
import { inspectOnboarding, recoverOnboardingPromotion, reviewOnboarding, startOnboarding } from "../scripts/lib/onboarding.mjs";
import { inspectConversationalOnboarding } from "../scripts/lib/onboarding-conversation.mjs";
import { readProductModelCanon } from "../scripts/lib/product-model.mjs";
import { inspectWorldModel } from "../scripts/lib/world-model.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = new URL("../scripts/lib/onboarding.mjs", import.meta.url).href;
const canonPath = ".head/context/product-model.json";
const statePath = ".head/onboarding/current.json";
const reviewDirectory = ".head/onboarding/review-decisions";

async function fixture() {
  const root = fs.mkdtempSync(path.join(pluginRoot, ".qa-onboarding-recovery-"));
  try {
    fs.writeFileSync(path.join(root, "README.md"), "# Message delivery service\n");
    initializeProject({ root, pluginRoot, runtimes: ["codex"] });
    const started = await startOnboarding({
      root, mode: "new", brief: {
        schemaVersion: 1, name: "Message service", summary: "Deliver one reviewed message.",
        capabilities: [{ key: "delivery", name: "Delivery", description: "Deliver a message." }],
      },
    });
    return { root, request: { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all", rationale: "Adopt the reviewed delivery capability." } };
  } catch (error) { fs.rmSync(root, { recursive: true, force: true }); throw error; }
}

function authorityBytes(root) {
  return [".head/project.json", ".head/sessions/current.json", canonPath, statePath]
    .map((relative) => fs.readFileSync(path.join(root, relative), "utf8"));
}

// Inject a process exit immediately after a real durable rename. The production
// modules and source are unchanged; no test-only crash switch exists in Core.
function interruptedReview(request, boundary, { throwInstead = false } = {}) {
  const source = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const request = ${JSON.stringify(request)};
    const boundary = ${JSON.stringify(boundary)};
    process.stderr.write(JSON.stringify({event:'process-start',pid:process.pid,parentPid:process.ppid,command:process.execPath+' onboarding crash injection '+boundary,cwd:process.cwd(),ports:[]})+'\\n');
    const original = fs.renameSync;
    let revisions = 0;
    let states = 0;
    fs.renameSync = function(from, to) {
      const relative = path.relative(request.root, String(to)).replaceAll('\\\\','/');
      const result = original.apply(this, arguments);
      const isRevision = relative.startsWith('.head/onboarding/product-model-revisions/');
      if (isRevision) revisions++;
      if (relative === ${JSON.stringify(statePath)}) states++;
      const hit = boundary === 'revision-1' && isRevision && revisions === 1
        || boundary === 'revision-2' && isRevision && revisions === 2
        || boundary === 'decision' && relative.startsWith(${JSON.stringify(`${reviewDirectory}/`)})
        || boundary === 'canon' && relative === ${JSON.stringify(canonPath)}
        || boundary === 'state-1' && relative === ${JSON.stringify(statePath)} && states === 1
        || boundary === 'world' && relative === '.head/world-model/current.json'
        || boundary === 'state-2' && relative === ${JSON.stringify(statePath)} && states === 2;
      if (hit) {
        process.stderr.write(JSON.stringify({event:'injected-boundary',pid:process.pid,boundary,relative})+'\\n');
        ${throwInstead ? "throw Object.assign(new Error('Injected projection failure'), {code:'TEST_PROJECTION_FAILURE'});" : "process.exit(44);"}
      }
      return result;
    };
    syncBuiltinESMExports();
    const {reviewOnboarding} = await import(${JSON.stringify(moduleUrl)});
    const result = await reviewOnboarding(request);
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: pluginRoot, encoding: "utf8", timeout: 45_000,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.error, undefined, `subprocess must complete: ${result.error}`);
  assert.equal(result.signal, null);
  assert.equal(result.status, throwInstead ? 0 : 44, result.stderr);
  process.stderr.write(`${JSON.stringify({ event: "process-ended", pid: result.pid, ports: [] })}\n`);
  return throwInstead ? JSON.parse(result.stdout) : null;
}

test("onboarding crash recovery follows durable approval at every publication boundary", async () => {
  for (const boundary of ["revision-1", "revision-2", "decision", "canon", "state-1", "world", "state-2"]) {
    const { root, request } = await fixture();
    try {
      const before = authorityBytes(root);
      interruptedReview(request, boundary);
      const afterCrash = authorityBytes(root);
      assert.deepEqual(afterCrash.slice(0, 2), before.slice(0, 2), "no Project/Session recovery mutation");
      const hasDecision = fs.existsSync(path.join(root, reviewDirectory));
      if (!hasDecision) {
        assert.equal(await recoverOnboardingPromotion({ root }), null);
        assert.deepEqual(authorityBytes(root), before, "unapproved revision evidence cannot change Canon");
        const completed = await reviewOnboarding(request);
        assert.equal(completed.status, "onboarding_ready");
      } else {
        const inspected = inspectOnboarding({ root });
        if (boundary !== "state-2") {
          assert.equal(inspected.status, "promotion_recovery_pending");
          const guide = inspectConversationalOnboarding({ root });
          assert.equal(guide.nextAction, "initialize_or_resume");
          assert.deepEqual(guide.materialChoicesRequired, []);
          const readOnlyBefore = authorityBytes(root);
          const coreResume = await initializeOrResumeProject({ root, pluginRoot, profile: "core" });
          assert.equal(coreResume.readiness.core.state, "ready");
          assert.deepEqual(authorityBytes(root), readOnlyBefore, "Core resume must not activate Product recovery");
        }
        await initializeOrResumeProject({ root, pluginRoot, profile: "product" });
      }
      assert.equal(inspectOnboarding({ root }).status, "ready", boundary);
      assert.equal(inspectWorldModel({ root }).status, "current");
      const completed = authorityBytes(root);
      const retry = await reviewOnboarding(request);
      assert.equal(retry.status, "onboarding_ready");
      assert.deepEqual(authorityBytes(root), completed, "identical retry must not create pointer generations");
      assert.equal(fs.readdirSync(path.join(root, reviewDirectory)).length, 1);
      await assert.rejects(() => reviewOnboarding({ ...request, rationale: "A different approval." }), { code: "ONBOARDING_REVIEW_REPLAY_CONFLICT" });
      assert.deepEqual(authorityBytes(root), completed);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("failed optional projection preserves approval and resumes without a second decision", async () => {
  const { root, request } = await fixture();
  try {
    const result = interruptedReview(request, "world", { throwInstead: true });
    assert.equal(result.status, "onboarding_approved_projection_pending");
    assert.equal(result.projection.ordinaryWorkBlocked, false);
    assert.equal(result.projection.userReviewRequired, false);
    assert.equal(readProductModelCanon({ projectRoot: root }).model.capabilities.length, 1);
    assert.equal(inspectOnboarding({ root }).status, "promotion_recovery_pending");
    await initializeOrResumeProject({ root, pluginRoot, profile: "product" });
    assert.equal(inspectOnboarding({ root }).status, "ready");
    assert.equal(fs.readdirSync(path.join(root, reviewDirectory)).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("recovery and old replay preserve a foreign later Canon and reject tampered decisions", async () => {
  const { root, request } = await fixture();
  try {
    interruptedReview(request, "decision");
    const canonFile = path.join(root, canonPath);
    const foreignCanon = JSON.parse(fs.readFileSync(canonFile, "utf8"));
    foreignCanon.capabilities.push({ key: "later", name: "Later approved state", description: "Must not be overwritten." });
    fs.writeFileSync(canonFile, `${JSON.stringify(foreignCanon)}\n`);
    const foreignBytes = fs.readFileSync(canonFile, "utf8");
    await assert.rejects(() => recoverOnboardingPromotion({ root }), { code: "ONBOARDING_PRODUCT_CANON_DRIFT" });
    await assert.rejects(() => reviewOnboarding(request), { code: "ONBOARDING_PRODUCT_CANON_DRIFT" });
    assert.equal(fs.readFileSync(canonFile, "utf8"), foreignBytes);
    const decisionFile = path.join(root, reviewDirectory, fs.readdirSync(path.join(root, reviewDirectory))[0]);
    const decision = JSON.parse(fs.readFileSync(decisionFile, "utf8"));
    const aliasFile = path.join(root, reviewDirectory, `onboarding-review-decision-${"0".repeat(24)}.json`);
    fs.renameSync(decisionFile, aliasFile);
    await assert.rejects(() => recoverOnboardingPromotion({ root }), { code: "ONBOARDING_REVIEW_IDENTITY_MISMATCH" });
    fs.renameSync(aliasFile, decisionFile);
    decision.rationale = "tampered";
    fs.writeFileSync(decisionFile, JSON.stringify(decision));
    await assert.rejects(() => recoverOnboardingPromotion({ root }), { code: "ONBOARDING_REVIEW_DIGEST_MISMATCH" });
    assert.equal(fs.readFileSync(canonFile, "utf8"), foreignBytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("concurrent identical reviews converge and completed replay does not refresh later source edits", async () => {
  const { root, request } = await fixture();
  try {
    const results = await Promise.all([reviewOnboarding(request), reviewOnboarding(request)]);
    assert.equal(results[0].reviewDecision.reviewDecisionId, results[1].reviewDecision.reviewDecisionId);
    assert.equal(fs.readdirSync(path.join(root, reviewDirectory)).length, 1);
    const stable = authorityBytes(root);
    const worldPointer = fs.readFileSync(path.join(root, ".head/world-model/current.json"), "utf8");
    fs.appendFileSync(path.join(root, "README.md"), "\nLater repository evidence.\n");
    const replay = await reviewOnboarding(request);
    assert.equal(replay.status, "onboarding_approved_projection_pending");
    assert.equal(replay.productCanonChanged, false);
    assert.deepEqual(authorityBytes(root), stable);
    assert.equal(fs.readFileSync(path.join(root, ".head/world-model/current.json"), "utf8"), worldPointer);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("approved promotion recovers without a retained World graph", async () => {
  const { root, request } = await fixture();
  try {
    interruptedReview(request, "decision");
    fs.rmSync(path.join(root, ".head/world-model"), { recursive: true, force: true });
    const result = await recoverOnboardingPromotion({ root });
    assert.equal(result.status, "onboarding_ready");
    assert.equal(inspectOnboarding({ root }).status, "ready");
    assert.equal(fs.readdirSync(path.join(root, reviewDirectory)).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("decision deletion between recovery lookup and commit cannot publish Canon from memory", async () => {
  const { root, request } = await fixture();
  const originalRead = fs.readFileSync;
  try {
    interruptedReview(request, "decision");
    const before = authorityBytes(root);
    const decisionFile = path.join(root, reviewDirectory, fs.readdirSync(path.join(root, reviewDirectory))[0]);
    let decisionReads = 0;
    fs.readFileSync = function (file, ...options) {
      const bytes = originalRead.call(this, file, ...options);
      if (path.resolve(String(file)) === decisionFile && ++decisionReads === 2) fs.unlinkSync(decisionFile);
      return bytes;
    };
    await assert.rejects(() => recoverOnboardingPromotion({ root }), { code: "ONBOARDING_REVIEW_NOT_FOUND" });
    fs.readFileSync = originalRead;
    assert.equal(decisionReads, 2, "delete after the approved decision was loaded into memory");
    assert.deepEqual(authorityBytes(root), before);
  } finally {
    fs.readFileSync = originalRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
