import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject, convergeProjectInstallation } from "../scripts/lib/head-core.mjs";
import { createHeadSession, createSessionCallContext, defaultSessionStatePath, withSessionCallContext, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { createSessionHostAdapter } from "../scripts/lib/session-host-adapter.mjs";
import { recordSessionWorkEvidence, readSessionWorkContext } from "../scripts/lib/session-work-context.mjs";
import { inspectRecoveryCheckpointBasis, syncRecoveryCheckpoint } from "../scripts/lib/compaction-recovery.mjs";
import { updateProjectDirection, assertProjectActionsCurrent } from "../scripts/lib/project-direction.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";

import { initialOnboardingDocuments } from "../scripts/lib/onboarding-contract.mjs";
import { emptyProductModelDocument, normalizeProductModelDocument } from "../scripts/lib/product-model.mjs";
import { formatForVerifiedOwner } from "../scripts/lib/project-storage-format.mjs";

// Synthetic legacy contract seed only; genuine old-producer interoperability is verified separately.
function seedLegacyProject(root) {
  root = fs.realpathSync(root);
  const createdAt = "2026-09-22T00:00:00.000Z";
  const project = { schemaVersion: 1, projectId: `head-${crypto.createHash("sha256").update(root).digest("hex").slice(0, 20)}`,
    projectRoot: root, createdAt, runtimes: ["claude", "codex", "opencode"], integrations: {},
    authority: { head: "ordinary investigation, strategy, integration, and completion judgment",
      user: "material product, policy, architecture, cost, workflow, and consequential external actions" } };
  const sessionState = { schemaVersion: 1, sessionId: `session-${crypto.randomUUID()}`, mode: "session",
    currentWholePlanId: null, activeRunId: null, activeExecutionContractId: null, lastResultPacketId: null,
    pendingReview: null, lastReviewDecisionId: null, requiredPlanAction: null, latestCheckpoint: null, updatedAt: createdAt };
  const product = emptyProductModelDocument();
  const onboarding = initialOnboardingDocuments({ project, sessionState,
    productModelId: normalizeProductModelDocument(product).productModelId, updatedAt: createdAt });
  const records = new Map([
    [".head/project.json", project], [".head/sessions/current.json", sessionState],
    [".head/context/knowledge.json", { schemaVersion: 1, evidence: [], claims: [], decisions: [], unknowns: [] }],
    [".head/context/product-model.json", product], [".head/onboarding/current.json", onboarding.state],
    [`.head/sessions/records/${onboarding.sessionRecord.sessionId}.json`, onboarding.sessionRecord],
    [`.head/onboarding/storage-selections/${onboarding.storageSelection.storageSelectionId}.json`, onboarding.storageSelection],
  ]);
  for (const [relative, value] of records) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  }
  fs.mkdirSync(path.join(root, ".head/instructions"), { recursive: true });
  fs.writeFileSync(path.join(root, ".head/instructions/project.md"), "# Project-specific HEAD context\n\nRecord project identity, canonical sources, repository boundaries, and fixed constraints here.\n", { flag: "wx" });
  const immutable = [...records.keys()].filter(relative => relative === ".head/project.json"
    || relative.startsWith(".head/sessions/records/") || relative.startsWith(".head/onboarding/storage-selections/"));
  const manifest = { schemaVersion: 1, generatedAt: createdAt, pluginRoot,
    packageVersion: JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"))).version,
    managed: immutable.map(relative => ({ path: relative, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex") })) };
  fs.mkdirSync(path.join(root, ".head/generated"), { recursive: true });
  fs.writeFileSync(path.join(root, ".head/generated/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const inspected = inspectProject(root); assert.equal(inspected.status, "ready");
  assert.equal(inspected.storage.directory, ".head");
  return { project };
}

const pluginRoot = path.resolve(import.meta.dirname, "..");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
function snapshot(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? snapshot(file) : [{ path: file, hash: sha(fs.readFileSync(file)), mtime: fs.statSync(file).mtimeMs }];
  });
}
function fixture(t, { checkpoint = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-cohesion-")));
  const root = path.join(base, "project"), operational = path.join(base, "operational");
  fs.mkdirSync(root);
  t.after(() => {
    assert.equal(path.dirname(base), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(base).startsWith("head-cohesion-"));
    fs.rmSync(base, { recursive: true, force: true });
  });
  initializeProject({ root, pluginRoot, runtimes: ["codex", "claude", "opencode"] });
  const storage = inspectProject(root).storage, directory = formatForVerifiedOwner(storage).directory;
  const selected = createHeadSession({ root, purpose: "Independent synthetic design investigation" }).sessionId;
  updateProjectDirection({ root, input: { goal: "Explain an exact-comparison tradeoff", constraints: ["Read only"], cancelledActions: ["deploy"] } });
  withSessionRoute(root, selected, () => {
    recordSessionWorkEvidence({ root, input: { judgments: [{ assessment: "Keep exact comparison", reason: "Case is significant" }], pending: ["Explain the tradeoff"], unknowns: ["No Host experiment"] } });
    if (checkpoint) syncRecoveryCheckpoint({ root, expectedRecoveryBasisId: inspectRecoveryCheckpointBasis({ root }).basis.basisId,
      purpose: "Compare designs", approvedDecisions: ["Read-only evaluation"], currentPosition: "Evidence retained", nextExpectedResult: "Explain the tradeoff" });
  });
  return { base, root, storage, directory, selected, operational, environment: { HEAD_AGENT_OPERATIONAL_STATE_ROOT: operational } };
}
const call = (root, name, session, options = {}) => dispatch({ jsonrpc: "2.0", id: "cohesion-fixture", method: "tools/call",
  params: { name, arguments: { project_root: root, ...(session ? { session_id: session } : {}) } } }, options);
async function readAll(f, { checkpoint = true, host = null } = {}) {
  const before = snapshot(f.base), options = host ? { resolveSessionContext: host.resolveSessionContext } : {};
  const entry = await call(f.root, "head_conversation_enter", host ? null : f.selected, options);
  assert.equal(entry.error, undefined, JSON.stringify(entry.error));
  const value = entry.result.structuredContent;
  assert.equal(value.status, checkpoint ? "conversation_direction_restored" : "conversation_ready");
  assert.equal(value.workContext.sessionId, f.selected);
  assert.equal(value.workContext.records[0].content.judgments[0].reason, "Case is significant");
  assert.deepEqual(value.projectStatus.currentProjectDirection.input.cancelledActions, ["deploy"]);
  assert.equal(value.ordinaryWorkBlocked, false);
  assert.equal(value.recoveryDependentWorkBlocked, false);
  assert.equal(value.userDecisionRequired, false);
  assert.equal(value.projectStatus.nextAction.id, "work_directly");
  assert.equal(value.persisted, false);
  const work = await call(f.root, "head_session_work_read", host ? null : f.selected, options);
  assert.equal(work.error, undefined);
  assert.equal(work.result.structuredContent.sessionId, f.selected);
  if (checkpoint) {
    const restore = await call(f.root, "head_session_restore", host ? null : f.selected, options);
    assert.equal(restore.error, undefined, JSON.stringify(restore.error));
  }
  assert.deepEqual(snapshot(f.base), before, "Entry/read/restore must not repair, publish, select or write");
  return value;
}

for (const [name,relative,remove] of [
  ["edited instructions", "AGENTS.md", false], ["deleted instructions", "AGENTS.md", true],
  ["generated instructions", ["generated", "lode-instructions.md"], false],
  ["generated role", ["roles", "lode.md"], false], ["provider configuration", ".mcp.json", false],
]) test(`projection-only ${name} preserves original recovery and evidence`, async t => {
  const f = fixture(t), file = Array.isArray(relative) ? path.join(f.root, f.directory, ...relative) : path.join(f.root, relative);
  if (remove) fs.unlinkSync(file); else fs.appendFileSync(file, "\nUser-owned local variation.\n");
  assert.equal(inspectProject(f.root).status, "drifted");
  const entry = await readAll(f);
  assert.equal(entry.projectStatus.readiness.core.projectionDriftOnly, true);
  assert.equal(entry.presentation.userDecisionRequired, false);
  assert.equal(entry.headActionRequired, false);
  assert.throws(() => convergeProjectInstallation({ root: f.root, pluginRoot }), { code: "PROJECT_NOT_READY" });
  withSessionRoute(f.root, f.selected, () => {
    const basis = inspectRecoveryCheckpointBasis({ root: f.root });
    assert.equal(basis.syncAvailability, "unavailable-managed-projection-drift");
    assert.throws(() => syncRecoveryCheckpoint({ root: f.root, expectedRecoveryBasisId: basis.basis.basisId }), { code: "MANAGED_DRIFT" });
    assert.doesNotThrow(() => recordSessionWorkEvidence({ root: f.root, input: { unknowns: ["Still ordinary P3 work"] } }));
  });
  assert.throws(() => assertProjectActionsCurrent({ root: f.root, actions: ["deploy"] }), { code: "PROJECT_ACTION_CANCELLED" });
});

test("projection drift without checkpoint still composes meaningful workContext", async t => {
  const f = fixture(t, { checkpoint: false });fs.appendFileSync(path.join(f.root,"AGENTS.md"),"\nPreference\n");
  await readAll(f, { checkpoint: false });
});

for (const [name,content] of [["malformed","{broken"],["null","null"],["invalid shape","{}"],["foreign owner",null],["missing",undefined]]) {
  test(`exact named Session ignores unrelated ${name} default`, async t => {
    const f = fixture(t), file = defaultSessionStatePath(f.root);
    if (name === "foreign owner") { const value = JSON.parse(fs.readFileSync(file));value.projectId="head-00000000000000000000";fs.writeFileSync(file,JSON.stringify(value)); }
    else if (content === undefined) fs.unlinkSync(file); else fs.writeFileSync(file,content);
    await readAll(f);
    const before = snapshot(f.base), failed = await call(f.root,"head_conversation_enter");
    assert.ok(failed.error, "Actual default request must not silently use the named Session");
    assert.deepEqual(snapshot(f.base),before);
  });
}

test("projection drift plus damaged default preserves exact selected recovery", async t => {
  const f=fixture(t);fs.appendFileSync(path.join(f.root,"AGENTS.md"),"\nPreference\n");fs.writeFileSync(defaultSessionStatePath(f.root),"null");
  await readAll(f);
});

test("Host context, retained binding and selection preflight isolate default damage", async t => {
  const f=fixture(t), host=createSessionHostAdapter({ runtime:"codex",nativeSessionId:"synthetic-cohesion-caller",environment:f.environment });
  fs.writeFileSync(defaultSessionStatePath(f.root),"{broken");
  const context=createSessionCallContext();assert.equal(context.select(f.root,f.selected).sessionId,f.selected);
  assert.equal(withSessionCallContext({root:f.root,context},()=>readSessionWorkContext({root:f.root}).sessionId),f.selected);
  const attempt=host.prepareSelection({root:f.root,sessionId:f.selected});assert.equal(attempt.prepared,true);
  assert.equal(host.settleSelection({ticket:attempt.ticket,outcome:"succeeded"}).retained,true);
  await readAll(f,{host});
  fs.writeFileSync(path.join(f.root,f.directory,"sessions/by-id",f.selected,"current.json"),"null");
  const failed=await call(f.root,"head_conversation_enter",null,{resolveSessionContext:host.resolveSessionContext});
  assert.ok(failed.error || failed.result?.structuredContent?.status==="session_selection_unresolved");
});

test("failed selection cannot guess an unreadable absent default predecessor", t => {
  const f=fixture(t),host=createSessionHostAdapter({runtime:"codex",nativeSessionId:"synthetic-predecessor",environment:f.environment});
  fs.unlinkSync(defaultSessionStatePath(f.root));
  const attempt=host.prepareSelection({root:f.root,sessionId:f.selected});
  const outcome=host.settleSelection({ticket:attempt.ticket,outcome:"not-started"});
  assert.equal(outcome.reasonCode,"PRIOR_SELECTION_UNCERTAIN");
  assert.equal(outcome.executionReplayAllowed,false);
  assert.equal(host.read({root:f.root}).status,"pending");
});

test("legacy default without projectId stays usable without migration", async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "head-cohesion-legacy-"));
  const root = fs.realpathSync(base);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  seedLegacyProject(root);
  const f = { base, root }, file = defaultSessionStatePath(root), state = JSON.parse(fs.readFileSync(file));
  delete state.projectId;fs.writeFileSync(file,JSON.stringify(state));
  const before=snapshot(f.base),reply=await call(f.root,"head_conversation_enter",state.sessionId);
  assert.equal(reply.error,undefined);assert.equal(reply.result.structuredContent.status,"conversation_ready");
  assert.deepEqual(snapshot(f.base),before);
});

test("null or foreign default predecessor cannot block exact new Host selection", t => {
  const f=fixture(t),file=defaultSessionStatePath(f.root),original=JSON.parse(fs.readFileSync(file));
  for(const [index,content] of ["null",JSON.stringify({...original,projectId:"head-00000000000000000000"})].entries()){
    fs.writeFileSync(file,content);
    const host=createSessionHostAdapter({runtime:"codex",nativeSessionId:`synthetic-default-${index}`,environment:f.environment});
    const prepared=host.prepareSelection({root:f.root,sessionId:f.selected});assert.equal(prepared.prepared,true);
    assert.equal(host.settleSelection({ticket:prepared.ticket,outcome:"succeeded"}).retained,true);
  }
});

for (const kind of ["project bytes","unknown managed path","manifest JSON","selected Session","duplicate identity","selected owner","checkpoint digest"]) {
  test(`actual ${kind} damage is not projection-only eligibility`, async t => {
    const f=fixture(t),named=path.join(f.root,f.directory,"sessions/by-id",f.selected,"current.json");
    if(kind==="project bytes")fs.appendFileSync(path.join(f.root,f.directory,"project.json"),"\n");
    if(kind==="manifest JSON")fs.writeFileSync(path.join(f.root,f.directory,"generated/manifest.json"),"{broken");
    if(kind==="unknown managed path"){
      const manifestFile=path.join(f.root,f.directory,"generated/manifest.json"),manifest=JSON.parse(fs.readFileSync(manifestFile));
      manifest.managed.push({path:`${f.directory}/unclassified-original.json`,sha256:sha("trusted")});
      fs.writeFileSync(path.join(f.root,f.directory,"unclassified-original.json"),"different");fs.writeFileSync(manifestFile,JSON.stringify(manifest));
    }
    if(kind==="selected Session")fs.writeFileSync(named,"null");
    if(kind==="selected owner"){const state=JSON.parse(fs.readFileSync(named));state.projectId="head-00000000000000000000";fs.writeFileSync(named,JSON.stringify(state));}
    if(kind==="duplicate identity"){const state=JSON.parse(fs.readFileSync(defaultSessionStatePath(f.root)));state.sessionId=f.selected;fs.writeFileSync(defaultSessionStatePath(f.root),JSON.stringify(state));}
    if(kind==="checkpoint digest"){
      const state=JSON.parse(fs.readFileSync(named)),file=path.join(f.root,f.directory,"sessions/ledger",`${state.latestCheckpoint}.json`);
      const value=JSON.parse(fs.readFileSync(file));value.purpose="untrusted replacement";fs.writeFileSync(file,JSON.stringify(value));
    }
    const before=snapshot(f.base),restore=await call(f.root,"head_session_restore",f.selected);
    assert.ok(restore.error,JSON.stringify(restore));
    const entry=await call(f.root,"head_conversation_enter",f.selected);
    assert.ok(entry.error || entry.result.structuredContent.recoveryDependentWorkBlocked);
    assert.deepEqual(snapshot(f.base),before);
  });
}

test("generated and Skill guidance preserve native boundaries without repeated implementation paragraphs", t => {
  const f=fixture(t),skill=fs.readFileSync(path.join(pluginRoot,"skills/lode-agent-core/SKILL.md"),"utf8");
  const generated=fs.readFileSync(path.join(f.root,"AGENTS.md"),"utf8").replace(/`/g,"").replace(/\s+/g," ");
  for(const guidance of[generated,skill.replace(/\s+/g," ")]){
    assert.match(guidance,/verified (?:Host selection|explicit route)/i);
    assert.match(guidance,/startup (?:lookup is read-only|only reads)/i);
    assert.match(guidance,/bind\/save(?:\/ID)? (?:rituals|questions)/i);
    assert.match(guidance,/(?:never guess|identity guesses)/i);
    assert.match(guidance,/work.context (?:reference|and Host limits)/i);
  }
  const detail=fs.readFileSync(path.join(pluginRoot,"docs/session-work-context.md"),"utf8");
  assert.match(detail,/params\._meta\.threadId/);
  assert.match(detail,/same-instance|Same-instance/);
  assert.match(detail,/No native Hook integration claimed/);
  assert.match(detail,/Normal model calls,[\s\S]*?cannot prepare this linkage/);
  assert.match(detail,/The helper returns `\{\}` and never supplies `permissionDecision`/);
  assert.equal(generated.includes("They do not propagate native identity into stock MCP automatically."),false);
});

test("new dependency leaves cannot transitively reach World or runtime orchestration", () => {
  const graph=new Map(),directory=path.join(pluginRoot,"scripts/lib");
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith(".mjs"))){
    const source=fs.readFileSync(path.join(directory,name),"utf8"),references=[...source.matchAll(/\b(?:import|export)\s+[\s\S]*?\bfrom\s*["']([^"']+)["']/g),...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)];
    graph.set(name,references.filter(match=>match[1].startsWith("./")).map(match=>path.basename(match[1])));
  }
  for(const leaf of ["session-paths.mjs","product-policy-records.mjs","runtime-invocation-storage.mjs","worker-patch-proposal-contract.mjs"]){
    const seen=new Set(),queue=[leaf];while(queue.length){const node=queue.pop();if(seen.has(node))continue;seen.add(node);queue.push(...(graph.get(node)||[]));}
    for(const forbidden of ["world-model.mjs","incremental-refresh.mjs","runtime-invocation-lifecycle.mjs","runtime-invocation-record.mjs","head-core.mjs","lode-core.mjs"])assert.equal(seen.has(forbidden),false,`${leaf} reaches ${forbidden}`);
  }
});
