import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { buildWorldModel, materializeWorldMarkdownProjection, captureWorldMarkdownChanges, inspectWorldModel } from "../scripts/lib/world-model.mjs";
import { applyDocumentChangeReview, reviewDocumentChanges, inspectDocumentChangeReviewStatus } from "../scripts/lib/document-change-review.mjs";
import { readProductModelCanon } from "../scripts/lib/product-model.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
async function fixture(disposition = "accept-all") {
  const root = fs.mkdtempSync(path.join(pluginRoot, ".qa-document-recovery-"));
  fs.writeFileSync(path.join(root, "service.mjs"), "export function deliver() { return true; }\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  await buildWorldModel({ root });
  materializeWorldMarkdownProjection({ root });
  fs.appendFileSync(path.join(root, ".head/generated/knowledge/index.md"), "\nReviewed proposal: message delivery.\n");
  const captured = captureWorldMarkdownChanges({ root, persist: true });
  const request = { root, candidateSetId: captured.candidateSet.candidateSetId, disposition: "accept-all", rationale: "Adopt the reviewed delivery capability.",
    resultingProductModel: { schemaVersion: 1, featureGroups: [], capabilities: [{ key: "delivery", name: "Delivery", description: "Deliver a message." }], features: [], requirements: [], constraints: [], decisions: [] } };
  if (disposition === "reject") { request.disposition = "reject"; delete request.resultingProductModel; }
  const reviewed = await reviewDocumentChanges({ ...request, apply: false });
  return { root, request, review: reviewed.reviewDecision };
}

function crash(root, reviewDecisionId, boundary) {
  const source = `
    import fs from 'node:fs'; import path from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    const root=${JSON.stringify(root)}, boundary=${JSON.stringify(boundary)};
    process.stderr.write(JSON.stringify({event:'started',pid:process.pid,parentPid:process.ppid,command:process.execPath+' document-crash '+boundary,cwd:process.cwd(),ports:[]})+'\\n');
    const rename=fs.renameSync; let worlds=0;
    fs.renameSync=function(from,to){ const result=rename.apply(this,arguments); const name=path.relative(root,String(to)).replaceAll('\\\\','/');
      if(name==='.head/world-model/current.json')worlds++;
      if(boundary==='canon'&&name==='.head/context/product-model.json'
        ||boundary==='markdown'&&name.startsWith('.head/generated/knowledge/')
        ||boundary==='receipt'&&name.startsWith('.head/document-changes/applications/')
        ||boundary==='audit-world'&&name==='.head/world-model/current.json'&&worlds===2)process.exit(44);
      return result;}; syncBuiltinESMExports();
    const {applyDocumentChangeReview}=await import(${JSON.stringify(new URL("../scripts/lib/document-change-review.mjs", import.meta.url).href)});
    await applyDocumentChangeReview({root,reviewDecisionId:${JSON.stringify(reviewDecisionId)}});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: pluginRoot, encoding: "utf8", timeout: 45000, windowsHide: true });
  process.stderr.write(result.stderr || "");
  process.stderr.write(`${JSON.stringify({ event: "closed", pid: result.pid, exitCode: result.status, ports: [] })}\n`);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 44, result.stderr);
}

test("durable document approval resumes actual Canon, partial Markdown, receipt and audit crashes", async () => {
  for (const boundary of ["canon", "markdown", "receipt", "audit-world", "legacy-canon"]) {
    const { root, request, review } = await fixture();
    try {
      const p2 = fs.readFileSync(path.join(root, ".head/sessions/current.json"));
      crash(root, review.reviewDecisionId, boundary === "legacy-canon" ? "canon" : boundary);
      const canon = fs.readFileSync(path.join(root, ".head/context/product-model.json"));
      assert.equal(readProductModelCanon({ projectRoot: root }).model.productModelId, review.resultingProductModelId);
      if (boundary === "legacy-canon") {
        fs.unlinkSync(path.join(root, ".head/document-changes/application-bases", `${review.reviewDecisionId}.json`));
        await buildWorldModel({ root });
      }
      process.stderr.write(`${JSON.stringify({ boundary, changes: inspectWorldModel({ root }).changes })}\n`);
      const result = await applyDocumentChangeReview({ root, reviewDecisionId: review.reviewDecisionId });
      assert.ok(["applied", "already-applied"].includes(result.status));
      assert.deepEqual(fs.readFileSync(path.join(root, ".head/context/product-model.json")), canon);
      assert.deepEqual(fs.readFileSync(path.join(root, ".head/sessions/current.json")), p2);
      assert.equal(inspectWorldModel({ root }).status, "current");
      assert.equal(inspectDocumentChangeReviewStatus({ root, candidateSetId: request.candidateSetId }).projectionsReady, true);
      assert.equal((await reviewDocumentChanges(request)).status, "already-applied");
      assert.equal(fs.readdirSync(path.join(root, ".head/document-changes/review-decisions")).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("document recovery preserves later user edits and never rolls approved Canon back", async () => {
  const { root, review } = await fixture();
  try {
    crash(root, review.reviewDecisionId, "markdown");
    const file = path.join(root, ".head/generated/knowledge/index.md");
    fs.appendFileSync(file, "\nLater user edit must survive.\n");
    const edited = fs.readFileSync(file);
    const canon = fs.readFileSync(path.join(root, ".head/context/product-model.json"));
    await assert.rejects(() => applyDocumentChangeReview({ root, reviewDecisionId: review.reviewDecisionId }), { code: "DOCUMENT_CHANGE_CANDIDATE_PUBLISHED_DRIFT" });
    assert.deepEqual(fs.readFileSync(file), edited);
    assert.deepEqual(fs.readFileSync(path.join(root, ".head/context/product-model.json")), canon);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("durable reject resumes partial publication before and after receipt without another approval", async () => {
  for (const boundary of ["markdown", "receipt", "legacy-markdown", "later-edit"]) {
    const { root, request, review } = await fixture("reject");
    try {
      const canon = fs.readFileSync(path.join(root, ".head/context/product-model.json"));
      const p2 = fs.readFileSync(path.join(root, ".head/sessions/current.json"));
      crash(root, review.reviewDecisionId, boundary === "receipt" ? "receipt" : "markdown");
      if (boundary === "legacy-markdown") fs.unlinkSync(path.join(root, ".head/document-changes/application-bases", `${review.reviewDecisionId}.json`));
      if (boundary === "later-edit") {
        const file = path.join(root, ".head/generated/knowledge/index.md");
        fs.appendFileSync(file, "\nLater edit stays.\n");
        const edited = fs.readFileSync(file);
        await assert.rejects(() => applyDocumentChangeReview({ root, reviewDecisionId: review.reviewDecisionId }), { code: "DOCUMENT_CHANGE_CANDIDATE_PUBLISHED_DRIFT" });
        assert.deepEqual(fs.readFileSync(file), edited);
      } else {
        await applyDocumentChangeReview({ root, reviewDecisionId: review.reviewDecisionId });
        assert.equal(inspectWorldModel({ root }).status, "current");
        assert.equal(inspectDocumentChangeReviewStatus({ root, candidateSetId: request.candidateSetId }).projectionsReady, true);
      }
      assert.deepEqual(fs.readFileSync(path.join(root, ".head/context/product-model.json")), canon);
      assert.deepEqual(fs.readFileSync(path.join(root, ".head/sessions/current.json")), p2);
      assert.equal(fs.readdirSync(path.join(root, ".head/document-changes/review-decisions")).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
