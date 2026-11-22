import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {defineTool} from "@agentic-tools/core";
import {createToolkit} from "../src/toolkit.js";
function fixture(t:any, execute:(input:any)=>Promise<unknown>, options:Record<string,any>={}) {
 const workspace=mkdtempSync(join(tmpdir(),"at-input-snapshot-"));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 return createToolkit({workspace,tools:[defineTool({name:"test.snapshot",description:"Snapshot",inputSchema:{type:"object"},sideEffect:"destructive",execute})],...options});
}
test("approval is bound to an immutable snapshot, not the caller's later changes", async t=>{
 let allow!:()=>void;
 let presented!:()=>void;
 const showing=new Promise<void>(r=>{presented=r;});
 const kit=fixture(t,async input=>input,{approvers:[{name:"fixture",approve:async()=>{presented();await new Promise<void>(r=>{allow=r;});return {outcome:"allow"};}}]});
 const input={command:"safe",nested:{target:"first"}};
 const pending=kit.invoke("test.snapshot",input);await showing;
 input.command="different";input.nested.target="second";allow();
 const result=await pending;
 assert.equal(result.status,"success");
 if(result.status==="success")assert.deepEqual(result.output,{command:"safe",nested:{target:"first"}});
});
test("tools cannot mutate the input used for classification and approval hashing", async t=>{
 const kit=fixture(t,async input=>{assert.ok(Object.isFrozen(input));assert.ok(Object.isFrozen(input.nested));return input;},{approvers:[{name:"fixture",approve:async()=>({outcome:"allow"})}]});
 assert.equal((await kit.invoke("test.snapshot",{nested:{items:[1,2]}})).status,"success");
});
test("cycles, accessors and non-JSON objects reject before execution or approval", async t=>{
 let calls=0,approvals=0,getters=0;
 const kit=fixture(t,async()=>{calls++;return "bad";},{approvers:[{name:"fixture",approve:async()=>{approvals++;return {outcome:"allow"};}}]});
 const cycle:any={};cycle.self=cycle;
 for(const input of [cycle,{value:1n},{value:new Date()},{value:Infinity},{value:undefined},{value:Object.assign([1],{extra:"not-json"})},{value:new Array(2)},Object.defineProperty({},"value",{enumerable:true,get(){getters++;return 1;}})]) {
  const result=await kit.invoke("test.snapshot",input);
  assert.equal(result.status==="error"&&result.error.code,"validation");
 }
 assert.equal(calls,0);assert.equal(approvals,0);assert.equal(getters,0);
});
