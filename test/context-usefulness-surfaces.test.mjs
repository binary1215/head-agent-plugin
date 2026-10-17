import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {initializeProject} from '../scripts/lib/head-core.mjs';
import {createHeadSession,withSessionRoute} from '../scripts/lib/session-routing.mjs';
import {recordSessionWorkEvidence,readSessionWorkContext} from '../scripts/lib/session-work-context.mjs';
import {updateProjectDirection} from '../scripts/lib/project-direction.mjs';
import {createSessionHostAdapter} from '../scripts/lib/session-host-adapter.mjs';
import {sessionStartContext} from '../scripts/session-host-hook.mjs';
import {runCommand} from '../scripts/head.mjs';
import {dispatch} from '../scripts/mcp-server.mjs';
import {formatCliResult,formatMcpToolContent} from '../scripts/lib/cli-presentation.mjs';

const pluginRoot=path.resolve(import.meta.dirname,'..');
function fixture(t){
 const parent=process.env.HEAD_AGENT_TEST_TMP||os.tmpdir();fs.mkdirSync(parent,{recursive:true});
 const base=fs.realpathSync(fs.mkdtempSync(path.join(parent,'head-usefulness-surface-'))),root=path.join(base,'project'),operational=path.join(base,'host');
 fs.mkdirSync(root);initializeProject({root,pluginRoot,runtimes:['codex','claude','opencode']});
 const selected=createHeadSession({root,purpose:'Explain the synthetic cache behavior; no deployment or external calls.'});
 if(process.env.HEAD_AGENT_KEEP_TEST_TMP!=='1')t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 return{base,root,operational,selected,route:fn=>withSessionRoute(root,selected.sessionId,fn)};
}
function snapshot(root){
 return fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
  const file=path.join(e.parentPath,e.name),stat=fs.statSync(file);
  return[path.relative(root,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),stat.size,stat.mtimeMs,stat.mode];
 }).sort(([a],[b])=>a.localeCompare(b));
}
async function call(root,name,args={},routed=false){
 const response=await dispatch({jsonrpc:'2.0',id:'synthetic-usefulness',method:'tools/call',params:{name:routed?'head_tools_call':name,
  arguments:routed?{name,arguments:{project_root:root,...args}}:{project_root:root,...args}}});
 assert.equal(response.error,undefined,JSON.stringify(response));assert.equal(response.result?.isError,undefined,JSON.stringify(response));
 const value=response.result.structuredContent;
 // Preserve the existing readable heading + selected JSON presentation, not
 // a newly invented raw-JSON-only text contract.
 if(name==='head_session_work_read'){
  const text=response.result.content[0].text;assert.equal(text,formatMcpToolContent(name,value));
  const presented=JSON.parse(text.slice(text.indexOf('\n')+1));
  assert.deepEqual(presented.coverage,value.coverage);assert.deepEqual(presented.omissions,value.omissions);
  assert.equal(presented.nextAfterEvidenceId,value.nextAfterEvidenceId);
  assert.deepEqual(presented.records.map(r=>r.evidenceId),value.records.map(r=>r.evidenceId));
 }
 return value;
}
test('generated instructions lead with the original outcome and preserve only necessary working boundaries',t=>{
 const f=fixture(t),text=fs.readFileSync(path.join(f.root,'.head/generated/head-instructions.md'),'utf8');
 assert.match(text,/understand the user's work.*finish the whole outcome/);
 assert.match(text,/Keep the user's original task as the active objective/);
 assert.match(text,/Work directly by default/);assert.match(text,/current request bounds action/);
 assert.match(text,/common constraints\/cancellations.*selected Session's P2/);
 assert.match(text,/Preserve completed contributions and user edits/);
 assert.match(text,/No per-turn save or mandatory sync\/Run\/Capsule; no duplicate administrative approval ritual/);
 assert.match(text,/Never infer a disposition from keyword matching, silence, or a default/);
 assert.match(text,/do not repeat status unless state changed/);
 assert.match(text,/distinguish mechanical coverage from semantic sufficiency/);
 assert.match(text,/Use existing progressive references only when their detail is relevant/);
 assert.match(text,/Capability does not grant authorization/);
});
test('default selected work coverage crosses CLI and direct/router MCP without extra calls or writes',async t=>{
 const f=fixture(t);for(let i=0;i<10;i++)f.route(()=>recordSessionWorkEvidence({root:f.root,input:{summary:`Synthetic observation ${i}`,occurrenceKey:`useful-${i}`}}));
 const expected=f.route(()=>readSessionWorkContext({root:f.root})),before=snapshot(f.base);
 assert.equal(expected.nextAfterEvidenceId,null);assert.equal(expected.coverage.inspected,10);
 assert.equal(expected.coverage.valid,10);assert.equal(expected.coverage.unavailable,0);
 assert.equal(expected.omissions.uninspected,0);assert.equal(expected.omissions.byBudget,2);
 assert.equal(expected.omissions.unavailableDetailCount,0);
 const cli=await runCommand(['session-work-read',f.root,'--session',f.selected.sessionId]);assert.deepEqual(cli,expected);
 const presentation=formatCliResult('session-work-read',cli);assert.match(presentation,/"nextAfterEvidenceId":null/);
 assert.match(presentation,/"unavailableDetailCount":0/);
 for(const routed of[false,true]){
  const actual=await call(f.root,'head_session_work_read',{session_id:f.selected.sessionId},routed);assert.deepEqual(actual,expected);
  const entry=await call(f.root,'head_conversation_enter',{session_id:f.selected.sessionId},routed);
  assert.deepEqual(entry.workContext,expected);assert.equal(entry.ordinaryWorkBlocked,false);
 }
 assert.deepEqual(snapshot(f.base),before);
});
for(const runtime of['codex','claude'])test(`${runtime} healthy startup is useful without a mandatory follow-up or selection write`,t=>{
 const f=fixture(t),environment={HEAD_AGENT_OPERATIONAL_STATE_ROOT:f.operational};
 updateProjectDirection({root:f.root,input:{goal:'Explain only',constraints:['No external effects'],cancelledActions:['deployment']}});
 const host=createSessionHostAdapter({runtime,nativeSessionId:'synthetic-surface',environment});assert.equal(host.select({root:f.root,sessionId:f.selected.sessionId,expectedRevision:0}).retained,true);
 const entry=host.enter({root:f.root}),before=snapshot(f.base);
 const output=sessionStartContext({runtime,environment,event:{hook_event_name:'SessionStart',source:'compact',session_id:'synthetic-surface',cwd:f.root}});
 const text=output.hookSpecificOutput.additionalContext,value=JSON.parse(text);
 assert.ok(text.length<=7000);assert.equal(value.sessionPurpose,entry.workContext.sessionPurpose);
 assert.deepEqual(value.currentProjectDirection,entry.projectStatus.currentProjectDirection);
 assert.deepEqual(value.route,{session_id:f.selected.sessionId});assert.equal(value.requiredSourceExpansion,undefined);
 assert.equal(value.persisted,false);assert.equal(value.ordinaryWorkBlocked,false);assert.equal(value.userDecisionRequired,false);
 assert.equal(value.sessionRecovery,null);assert.deepEqual(snapshot(f.base),before);
});
for(const runtime of['codex','claude'])test(`${runtime} lost linkage keeps independent current work visible without guessing or repair`,t=>{
 const f=fixture(t),environment={HEAD_AGENT_OPERATIONAL_STATE_ROOT:f.operational};
 updateProjectDirection({root:f.root,input:{goal:'Explain only',cancelledActions:['deployment']}});
 const host=createSessionHostAdapter({runtime,nativeSessionId:'synthetic-lost-linkage',environment});
 assert.equal(host.select({root:f.root,sessionId:f.selected.sessionId,expectedRevision:0}).retained,true);
 const binding=fs.readdirSync(f.operational,{recursive:true}).find(file=>file.endsWith('binding.json'));
 assert.ok(binding);fs.unlinkSync(path.join(f.operational,binding));
 const before=snapshot(f.base),entry=host.enter({root:f.root});
 assert.equal(entry.status,'session_selection_unresolved');
 const hook=sessionStartContext({runtime,environment,event:{hook_event_name:'SessionStart',source:'resume',session_id:'synthetic-lost-linkage',cwd:f.root}});
 const text=hook.hookSpecificOutput.additionalContext,value=JSON.parse(text);
 assert.ok(text.length<=7000);assert.equal(value.status,'session_selection_unresolved');
 assert.equal(value.logicalSessionId,null);assert.equal(value.sessionPurpose,null);assert.equal(value.route,null);
 assert.ok(JSON.stringify(value.currentProjectDirection).includes('deployment'));
 assert.equal(value.userDecisionRequired,false);assert.equal(value.ordinaryWorkBlocked,false);assert.equal(value.persisted,false);
 assert.deepEqual(snapshot(f.base),before);
});
