import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
const sourceRoot=path.resolve(import.meta.dirname,'..');
const {initializeOrResumeProject}=await import(pathToFileURL(sourceRoot+'/scripts/lib/project-bootstrap.mjs').href);
const {inspectProject,convergeProjectInstallation}=await import(pathToFileURL(sourceRoot+'/scripts/lib/lode-core.mjs').href);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const bytes=root=>fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{
 const file=path.join(e.parentPath,e.name);return[path.relative(root,file),fs.readFileSync(file).toString('base64')];
}).sort(([a],[b])=>a.localeCompare(b));
function fixture(t) {
 const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'lode-opencode-reconnect-'));
 t.after(()=>{assert.equal(path.dirname(root),parent);assert(path.basename(root).startsWith('lode-opencode-reconnect-'));fs.rmSync(root,{recursive:true,force:true});});
 const project=path.join(root,'project'),nextPlugin=path.join(root,'new-pc-plugin');
 fs.mkdirSync(project);fs.mkdirSync(path.join(nextPlugin,'scripts'),{recursive:true});
 fs.copyFileSync(path.join(sourceRoot,'package.json'),path.join(nextPlugin,'package.json'),fs.constants.COPYFILE_EXCL);
 fs.writeFileSync(path.join(nextPlugin,'scripts/mcp-server.mjs'),'// Synthetic path-only fixture; not executed.\n',{flag:'wx'});
 return {root,project,nextPlugin};
}
test('same canonical Project root reconnects a changed installation root without changing Project or Session',async t=>{
 const {project,nextPlugin}=fixture(t);
 await initializeOrResumeProject({root:project,pluginRoot:sourceRoot,profile:'core',runtimes:['opencode']});
 const before=inspectProject(project),directory=before.storage.directory;
 const projectBytes=fs.readFileSync(path.join(project,directory,'project.json'));
 const sessionBytes=fs.readFileSync(path.join(project,directory,'sessions/current.json'));
 const oldCommand=read(path.join(project,'opencode.json')).mcp.lode.command;
 await initializeOrResumeProject({root:project,pluginRoot:nextPlugin,profile:'core'});
 const after=inspectProject(project),config=read(path.join(project,'opencode.json'));
 assert.equal(after.project.projectId,before.project.projectId);assert.equal(after.state.sessionId,before.state.sessionId);
 assert.deepEqual(after.project.runtimes,before.project.runtimes);
 assert.deepEqual(fs.readFileSync(path.join(project,directory,'project.json')),projectBytes);
 assert.deepEqual(fs.readFileSync(path.join(project,directory,'sessions/current.json')),sessionBytes);
 assert.equal(config.mcp.lode.command[0],process.execPath);
 assert.equal(config.mcp.lode.command[1],path.join(fs.realpathSync(nextPlugin),'scripts/mcp-server.mjs'));
 assert.notEqual(config.mcp.lode.command[1],oldCommand[1]);
 t.diagnostic(JSON.stringify({case:'plugin-root-only',projectIdentityPreserved:true,sessionBytesPreserved:true,hostLoaded:false}));
});
test('project-owned OpenCode configuration stays byte-identical while the generated suggestion reconnects',async t=>{
 const {project,nextPlugin}=fixture(t),file=path.join(project,'opencode.json');
 const original='{"mcp":{"custom":{"type":"local","command":["custom-engine"],"enabled":false}}}\n';
 fs.writeFileSync(file,original,{flag:'wx'});
 await initializeOrResumeProject({root:project,pluginRoot:sourceRoot,profile:'core',runtimes:['opencode']});
 const before=inspectProject(project);
 await initializeOrResumeProject({root:project,pluginRoot:nextPlugin,profile:'core'});
 assert.equal(fs.readFileSync(file,'utf8'),original);
 const generated=read(path.join(project,before.storage.directory,'generated/opencode.json'));
 assert.equal(generated.mcp.lode.command[1],path.join(fs.realpathSync(nextPlugin),'scripts/mcp-server.mjs'));
 const after=inspectProject(project);
 assert.equal(after.project.projectId,before.project.projectId);assert.equal(after.state.sessionId,before.state.sessionId);
 t.diagnostic(JSON.stringify({case:'project-owned-config',originalPreserved:true,generatedReconnected:true,hostLoaded:false}));
});
test('copying the Project to a different canonical root is rejected rather than silently migrated',async t=>{
 const {root,project,nextPlugin}=fixture(t);
 await initializeOrResumeProject({root:project,pluginRoot:sourceRoot,profile:'core',runtimes:['opencode']});
 const moved=path.join(root,'other-pc-project');
 fs.cpSync(project,moved,{recursive:true,errorOnExist:true,force:false});
 const sourceBefore=bytes(project),movedBefore=bytes(moved);
 assert.equal(inspectProject(moved).status,'not_initialized');
 assert.throws(()=>convergeProjectInstallation({root:moved,pluginRoot:nextPlugin}),{code:'NOT_INITIALIZED'});
 await assert.rejects(initializeOrResumeProject({root:moved,pluginRoot:nextPlugin,profile:'core'}),{code:'MANAGED_COLLISION'});
 assert.deepEqual(bytes(project),sourceBefore);assert.deepEqual(bytes(moved),movedBefore);
 t.diagnostic(JSON.stringify({case:'project-root-moved',inspection:'not_initialized',convergenceCode:'NOT_INITIALIZED',publicBootstrapCode:'MANAGED_COLLISION',sourceUnchanged:true,copyUnchanged:true,migrationImplemented:false}));
});
