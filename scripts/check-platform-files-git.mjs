/** Native filesystem/Git acceptance. Run on each OS before claiming support. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createToolkit } from '../packages/runtime/dist/src/index.js';
import { filesystem } from '../packages/filesystem/dist/src/index.js';
import { git } from '../packages/git/dist/src/index.js';
const base=mkdtempSync(join(tmpdir(),'agentic-native-'));const root=join(base,'workspace');const outside=join(base,'outside');mkdirSync(root);mkdirSync(outside);writeFileSync(join(outside,'sentinel.txt'),'private');
const run=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
try {
 run(['init','-b','main']);run(['config','user.name','Native Test']);run(['config','user.email','native@example.invalid']);
 const toolkit=createToolkit({workspace:root,tools:[...filesystem({only:['read','write','search','list','edit']}),...git({only:['status','diff','log','branches','add','commit','branch','switch','reset']})]});
 async function ok(name,input){const r=await toolkit.invoke(name,input);assert.equal(r.status,'success',JSON.stringify(r));return r.output;}
 async function denied(input){const r=await toolkit.invoke('filesystem.read',input);assert.equal(r.status==='error'&&r.error.code,'permission_denied',JSON.stringify(r));}
 await ok('filesystem.write',{path:'hello.txt',content:'native\n'});assert.match((await ok('filesystem.read',{path:join(root,'hello.txt')})).content,/native/);
 await ok('git.add',{pathspec:['hello.txt']});await ok('git.commit',{message:'native acceptance'});assert.equal((await ok('git.status',{})).clean,true);
 await ok('git.branch',{create:'native-check'});await ok('git.switch',{branch:'native-check'});assert.equal((await ok('git.status',{})).branch,'native-check');
 await denied({path:resolve(outside,'sentinel.txt')});await denied({path:join('..','outside','sentinel.txt')});
 symlinkSync(outside,join(root,'escape'),process.platform==='win32'?'junction':'dir');await denied({path:join('escape','sentinel.txt')});
 const scan=await ok('filesystem.search',{pattern:'**/*.txt'});assert.ok(!JSON.stringify(scan).includes('sentinel'));
 const controller=new AbortController();controller.abort();const cancelled=await toolkit.invoke('git.status',{},{signal:controller.signal});assert.equal(cancelled.status==='error'&&cancelled.error.code,'cancelled');
 console.log(`PASS native ${process.platform} Node ${process.version}: read/write, absolute/relative paths, Git commit/branch/switch, traversal/junction denial, search and cancellation`);
} finally {rmSync(base,{recursive:true,force:true});}
