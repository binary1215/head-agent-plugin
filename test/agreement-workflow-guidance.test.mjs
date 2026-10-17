import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {initializeProject,inspectProject} from '../scripts/lib/head-core.mjs';

const pluginRoot=path.resolve(import.meta.dirname,'..');
function project(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'head-agreement-guidance-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
}
const runtimes=['claude','codex','opencode'];
// These are source/consumer contracts, not a natural-language decision engine
// or evidence that a live model understands or follows the nine review cases.
test('agreement guidance reaches new generated and managed consumers without execution or review transitions',t=>{
 const root=project(t),result=initializeProject({root,pluginRoot,runtimes});
 assert.equal(result.status,'ready');
 const generated=fs.readFileSync(path.join(root,'.head/generated/head-instructions.md'),'utf8');
 for(const target of ['AGENTS.md','CLAUDE.md'])assert.equal(fs.readFileSync(path.join(root,target),'utf8'),generated);
 const opencode=JSON.parse(fs.readFileSync(path.join(root,'opencode.json'),'utf8'));
 assert.ok(opencode.instructions.includes('.head/generated/head-instructions.md'));
 assert.match(generated,/no duplicate administrative approval ritual/);
 assert.doesNotMatch(generated,/mandatory sync\/Run\/Capsule\/approval/);
 assert.match(generated,/current user decision for a new or changed protected target/);
 const inspected=inspectProject(root);assert.equal(inspected.status,'ready');
 assert.equal(inspected.project.runtimes.join(','),'claude,codex,opencode');
 for(const field of ['activeRunId','activeExecutionContractId','pendingReview','latestCheckpoint'])assert.equal(inspected.state[field],null);
});

test('agreement guidance preserves existing user instructions and exposes only the existing manual integration alternative',t=>{
 const root=project(t),originals={'AGENTS.md':'# User instructions\nKeep the user-owned scope.\n','CLAUDE.md':'# User instructions\nNo deployment.\n','opencode.json':'{"userOwned":true}\n'};
 for(const [name,bytes] of Object.entries(originals))fs.writeFileSync(path.join(root,name),bytes);
 const result=initializeProject({root,pluginRoot,runtimes});
 assert.equal(result.status,'ready_with_manual_integration');
 for(const [name,bytes] of Object.entries(originals))assert.equal(fs.readFileSync(path.join(root,name),'utf8'),bytes);
 const inspected=inspectProject(root);
 for(const runtime of runtimes)assert.equal(inspected.project.integrations[runtime].status,'manual');
 const alternative=fs.readFileSync(path.join(root,'.head/generated/head-instructions.md'),'utf8');
 assert.match(alternative,/Reuse concrete user agreement/);
 assert.match(alternative,/Saving grants no execution permission/);
});
