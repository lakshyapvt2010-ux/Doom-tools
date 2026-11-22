import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Agent,Runner,RunContext,RunToolApprovalItem} from "@openai/agents";
import {ScriptedModel,functionCall,assistantMessage} from "@openai/agents/testing";
import {defineTool} from "@agentic-tools/core";
import {createToolkit} from "@agentic-tools/runtime";
import {createOpenAIAgentsApprovalBridge} from "../src/index.js";
function fixture(t:any,sideEffect:"read"|"destructive"="destructive") {
 const workspace=mkdtempSync(join(tmpdir(),"at-native-oa-"));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 let calls=0;
 const tool=defineTool({name:"test.gated",description:"Native fixture",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]},sideEffect,execute:async(input:any)=>{calls++;return {ran:input.target};}});
 const kit=createToolkit({workspace,tools:[tool],policy:{secrets:["private-value"]}});
 const bridge=createOpenAIAgentsApprovalBridge(kit,{returnEnvelope:true});
 const model=new ScriptedModel([[functionCall("test_gated",{target:"private-value"},{callId:"call-native"})],[assistantMessage("done")]]);
 const agent=new Agent({name:"Native fixture",tools:bridge.tools,model});
 const runner=new Runner({tracingDisabled:true});
 return {kit,bridge,model,agent,runner,calls:()=>calls};
}
test("real SDK Runner interrupts and resumes a runtime-approved call exactly once",async t=>{
 const {kit,bridge,model,agent,runner,calls}=fixture(t);
 const paused=await runner.run(agent,"run");
 assert.equal(paused.interruptions.length,1);assert.equal(calls(),0);
 const request=bridge.listPending()[0]!.request;
 assert.match(request.inputPreview,/REDACTED/);assert.doesNotMatch(request.inputPreview,/private-value/);
 bridge.approve(paused.state,paused.interruptions[0]!,request.id);
 const done=await runner.run(agent,paused.state);
 assert.equal(done.finalOutput,"done");assert.equal(calls(),1);assert.equal(bridge.listPending().length,0);assert.equal(kit.listDeferredApprovals().length,0);
 model.assertComplete();
 await assert.rejects(()=>kit.resumeApproval(request.id,{outcome:"allow"},{name:"test.gated",input:{target:"private-value"}}),/consumed/);
});
test("native rejection executes nothing and clears the ticket",async t=>{
 const {kit,bridge,agent,runner,calls,model}=fixture(t);
 const paused=await runner.run(agent,"run");
 bridge.reject(paused.state,paused.interruptions[0]!,bridge.listPending()[0]!.request.id);
 const done=await runner.run(agent,paused.state);
 assert.equal(done.finalOutput,"done");assert.equal(calls(),0);assert.equal(kit.listDeferredApprovals().length,0);model.assertComplete();
});
test("SDK approval without the bridge never substitutes for runtime authority",async t=>{
 const {bridge,agent,runner,calls}=fixture(t);
 const paused=await runner.run(agent,"run");
 paused.state.approve(paused.interruptions[0]!,{alwaysApprove:true});
 await runner.run(agent,paused.state);
 assert.equal(calls(),0);assert.equal(bridge.listPending().length,0);
});
test("ungated reads execute once, not during the native approval probe",async t=>{
 const {bridge,agent,runner,calls,model}=fixture(t,"read");
 const done=await runner.run(agent,"run");
 assert.equal(done.interruptions.length,0);assert.equal(done.finalOutput,"done");assert.equal(calls(),1);assert.equal(bridge.listPending().length,0);model.assertComplete();
});
test("expired native tickets cannot be approved",async t=>{
 const {bridge,agent,runner,calls}=fixture(t);
 const paused=await runner.run(agent,"run");
 const request=bridge.listPending()[0]!.request;
 t.mock.method(Date,"now",()=>request.expiresAt+1);
 assert.throws(()=>bridge.approve(paused.state,paused.interruptions[0]!,request.id),/live runtime approval/);
 assert.equal(calls(),0);
});
test("a different input cannot execute after native approval",async t=>{
 const {bridge,agent,runner,calls}=fixture(t);
 const paused=await runner.run(agent,"run");
 const item=paused.interruptions[0]!;
 bridge.approve(paused.state,item,bridge.listPending()[0]!.request.id);
 const result=JSON.parse(await bridge.tools[0]!.invoke(new RunContext(),'{"target":"different"}',{toolCall:item.rawItem as any}));
 assert.equal(result.error.code,"permission_denied");assert.equal(calls(),0);
});
test("changed policy is re-evaluated after native approval",async t=>{
 const {kit,bridge,agent,runner,calls}=fixture(t);
 const paused=await runner.run(agent,"run");
 bridge.approve(paused.state,paused.interruptions[0]!,bridge.listPending()[0]!.request.id);
 kit._state.policy.approvals["test.gated"]="never";
 await runner.run(agent,paused.state);
 assert.equal(calls(),0);
});
test("unknown or mismatched request IDs never approve native state",async t=>{
 const {bridge,agent,runner,calls}=fixture(t);
 const paused=await runner.run(agent,"run");
 assert.throws(()=>bridge.approve(paused.state,paused.interruptions[0]!,"unknown"),/live runtime approval/);
 const original=paused.interruptions[0]!;
 const mismatched=new RunToolApprovalItem({...original.rawItem,callId:"different-call"} as any,original.agent);
 assert.throws(()=>bridge.approve(paused.state,mismatched,bridge.listPending()[0]!.request.id),/live runtime approval/);
 assert.equal(calls(),0);assert.equal(bridge.listPending().length,1);
});
