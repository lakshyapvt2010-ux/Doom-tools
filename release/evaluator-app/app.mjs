/** Separate application, real packaged dependency and SDK, scripted mock model. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, jsonSchema } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { createToolkit, filesystem, git, bash, callbackApprover, defineTool } from 'agentic-tools';
import { toVercelAI } from 'agentic-tools/adapter-vercel';
import { createMcpServer } from 'agentic-tools/adapter-mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const summary={application:'independent packaged repository repair app',model:'AI SDK MockLanguageModelV2, scripted one tool call per step',hostedModel:false,node:process.version,routes:[]};
for(const route of ['vercel-sdk','mcp']){
 const workspace=mkdtempSync(join(tmpdir(),'agentic-app-'+route+'-'));const approvals=[];
 const runGit=(...args)=>execFileSync('git',args,{cwd:workspace,encoding:'utf8'});
 let client,server;
 try{
  runGit('init','-q');runGit('config','user.name','Application Fixture');runGit('config','user.email','app@example.invalid');
  writeFileSync(join(workspace,'sum.cjs'),'module.exports = (a, b) => a - b;\n');
  writeFileSync(join(workspace,'sum.test.cjs'),"require('node:assert/strict').equal(require('./sum.cjs')(2, 3), 5);\n");
  runGit('add','.');runGit('commit','-qm','Broken fixture baseline');
  const toolkit=createToolkit({workspace,tools:[...filesystem({only:['read','search','edit']}),...git({only:['status','add','commit','log']}),...bash({mode:'trusted-host'})],policy:{approvals:{'filesystem.write':'always','git.write':'always','process.execute':'always'}},approvers:[callbackApprover(request=>{approvals.push(request.id);return{outcome:'allow',scope:'once'};})]});
  let invoke;
  if(route==='vercel-sdk'){
   const tools=toVercelAI(toolkit,{wrapSchema:jsonSchema,returnEnvelope:true,nameForTool:name=>name.replaceAll('.','_')});
   invoke=async(name,args)=>{
    const generated=await generateText({model:new MockLanguageModelV2({doGenerate:{content:[{type:'tool-call',toolCallId:'scripted-'+name,toolName:name.replaceAll('.','_'),input:JSON.stringify(args)}],finishReason:'tool-calls',usage:{inputTokens:1,outputTokens:1,totalTokens:2},warnings:[]}}),tools,prompt:'Execute the scripted next step of the fixture task.',maxRetries:0});
    assert.equal(generated.toolResults.length,1);return generated.toolResults[0].output;
   };
  }else{
   server=createMcpServer(toolkit);client=new Client({name:'independent-evaluator-app',version:'0.1.0'});
   const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(a),server.connect(b)]);
   invoke=async(name,args)=>(await client.callTool({name,arguments:args})).structuredContent;
  }
  async function call(name,args){const r=await invoke(name,args);assert.equal(r.status,'success',JSON.stringify(r));return r.output;}
  assert.match((await call('filesystem.read',{path:'sum.cjs'})).content,/a - b/);
  assert.match(JSON.stringify(await call('filesystem.search',{pattern:'*.cjs'})),/sum.cjs/);
  assert.notEqual((await call('bash.execute',{command:'node sum.test.cjs'})).exitCode,0);
  await call('filesystem.edit',{path:'sum.cjs',edits:[{find:'a - b',replace:'a + b'}]});
  assert.equal((await call('bash.execute',{command:'node sum.test.cjs'})).exitCode,0);
  await call('git.add',{pathspec:['sum.cjs']});const commit=await call('git.commit',{message:'Fix addition via packaged tools'});
  assert.match(commit.sha,/^[a-f0-9]{40}$/);assert.equal((await call('git.status',{})).clean,true);
  assert.equal(approvals.length,5);assert.equal(toolkit.traceRecords().length,8);assert.equal(toolkit.metrics().reduce((n,r)=>n+r.count,0),8);
  assert.match(readFileSync(join(workspace,'sum.cjs'),'utf8'),/a \+ b/);
  const hidden=await toolkit.select({sideEffect:['read']}).invoke('filesystem.edit',{path:'sum.cjs',edits:[]});assert.equal(hidden.status==='error'&&hidden.error.code,'permission_denied');
  const escape=await toolkit.invoke('filesystem.read',{path:'../outside.txt'});assert.equal(escape.status==='error'&&escape.error.code,'permission_denied');
  summary.routes.push({route,passed:true,successfulTaskCalls:8,approvals:approvals.length,commit:commit.sha,cleanWorkingTree:true,hiddenToolDenied:true,traversalDenied:true});
 }finally{if(client)await client.close();if(server)await server.close();rmSync(workspace,{recursive:true,force:true});}
}
const gated=defineTool({name:'app.gated',description:'No approver fixture',inputSchema:{type:'object'},sideEffect:'destructive',execute:()=>{throw new Error('must not run');}});
const denied=await createToolkit({workspace:process.cwd(),tools:[gated]}).invoke('app.gated',{});assert.equal(denied.status==='error'&&denied.error.code,'approval_required');summary.noApproverFailsClosed=true;
writeFileSync('result.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
