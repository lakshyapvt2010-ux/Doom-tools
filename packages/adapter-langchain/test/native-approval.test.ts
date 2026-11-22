import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {AIMessage} from "@langchain/core/messages";
import {StateGraph,MessagesAnnotation,MemorySaver,Command,START,END,interrupt} from "@langchain/langgraph";
import {ToolNode} from "@langchain/langgraph/prebuilt";
import {defineTool} from "@agentic-tools/core";
import {createToolkit} from "@agentic-tools/runtime";
import {toLangChain} from "../src/index.js";
function fixture(t:any) {
 const workspace=mkdtempSync(join(tmpdir(),"at-native-lg-"));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 let calls=0;
 const tool=defineTool({name:"test.gated",description:"Gated fixture",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]},sideEffect:"destructive",execute:async(input:any)=>{calls++;return {ran:input.target};}});
 const kit=createToolkit({workspace,tools:[tool],policy:{secrets:["private-value"]}});
 const tools=toLangChain(kit,{nameForTool:n=>n.replaceAll(".","_"),returnEnvelope:true,nativeApproval:{interrupt}});
 const graph=new StateGraph(MessagesAnnotation).addNode("tools",new ToolNode(tools,{handleToolErrors:false})).addEdge(START,"tools").addEdge("tools",END).compile({checkpointer:new MemorySaver()});
 const config={configurable:{thread_id:"fixture-"+Math.random()}};
 const input={messages:[new AIMessage({content:"",tool_calls:[{name:"test_gated",args:{target:"private-value"},id:"call-gated",type:"tool_call"}]})]};
 return {kit,graph,config,input,calls:()=>calls};
}
test("real LangGraph pauses with a runtime request and resumes exactly once after approval",async t=>{
 const {kit,graph,config,input,calls}=fixture(t);
 const paused:any=await graph.invoke(input,config);
 assert.equal(calls(),0);
 const request=paused.__interrupt__![0]!.value as {id:string,inputPreview:string,inputHash:string};
 assert.ok(request.id);assert.match(request.inputPreview,/REDACTED/);assert.doesNotMatch(request.inputPreview,/private-value/);
 assert.equal(kit.listDeferredApprovals().length,1);
 const resumed=await graph.invoke(new Command({resume:{requestId:request.id,outcome:"allow"}}),config);
 const result=JSON.parse(resumed.messages.at(-1)!.content as string);
 assert.equal(result.status,"success");assert.equal(calls(),1);assert.equal(kit.listDeferredApprovals().length,0);
 await assert.rejects(()=>kit.resumeApproval(request.id,{outcome:"allow"},{name:"test.gated",input:{target:"private-value"}}),/consumed/);
 assert.equal(calls(),1);
});
test("real LangGraph denial and malformed decisions never execute",async t=>{
 for(const outcome of ["deny","invalid"]) {
  const {graph,config,input,calls,kit}=fixture(t);
  const paused:any=await graph.invoke(input,config);
  const request=paused.__interrupt__![0]!.value as {id:string};
  const resumed=await graph.invoke(new Command({resume:{requestId:request.id,outcome}}),config);
  const result=JSON.parse(resumed.messages.at(-1)!.content as string);
  assert.equal(result.status,"error");assert.equal(result.error.code,"permission_denied");assert.equal(calls(),0);
  // Invalid responses cannot authorize anything; their older ticket expires
  // or can be explicitly discarded by the host.
  for(const pending of kit.listDeferredApprovals())kit.discardDeferredApproval(pending.id);
 }
});
test("expired native approvals fail closed after graph replay",async t=>{
 const {graph,config,input,calls}=fixture(t);
 const paused:any=await graph.invoke(input,config);
 const request=paused.__interrupt__![0]!.value as {id:string,expiresAt:number};
 t.mock.method(Date,"now",()=>request.expiresAt+1);
 const resumed=await graph.invoke(new Command({resume:{requestId:request.id,outcome:"allow"}}),config);
 const result=JSON.parse(resumed.messages.at(-1)!.content as string);
 assert.equal(result.error.code,"approval_required");assert.equal(calls(),0);
});
test("a forged or unrelated request ID cannot authorize native execution",async t=>{
 const {graph,config,input,calls}=fixture(t);
 await graph.invoke(input,config);
 const resumed=await graph.invoke(new Command({resume:{requestId:"not-a-ticket",outcome:"allow"}}),config);
 const result=JSON.parse(resumed.messages.at(-1)!.content as string);
 assert.equal(result.error.code,"approval_required");assert.equal(calls(),0);
});
