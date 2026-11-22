import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {defineTool,ToolError,type ToolResult} from "@agentic-tools/core";
import {createToolkit} from "../src/toolkit.js";
import {DeferredApprovals} from "../src/deferred-approvals.js";
import {ApprovalManager,createRedactor} from "@agentic-tools/security";
function fixture(t:any,options:Record<string,any>={}) {
 const workspace=mkdtempSync(join(tmpdir(),"at-defer-"));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 let calls=0;
 const tool=defineTool({name:"test.deferred",description:"Deferred fixture",inputSchema:{type:"object",properties:{target:{type:"string"}},required:["target"]},sideEffect:"destructive",execute:async(input:any)=>{calls++;return input;}});
 return {kit:createToolkit({workspace,tools:[tool],...options}),tool,calls:()=>calls};
}
const id=(r:ToolResult)=>{assert.equal(r.status,"error");if(r.status!=="error")throw Error();return r.error.details!.approvalRequestId as string;};
test("deferred requests are first-class, single-use and resume the exact approved input",async t=>{
 const {kit,calls}=fixture(t);
 const requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 assert.equal(calls(),0);assert.equal(kit.listPendingApprovals().length,0);assert.equal(kit.listDeferredApprovals().length,1);
 assert.equal(kit.listDeferredApprovals()[0]!.id,requestId);assert.ok(Object.isFrozen(kit.listDeferredApprovals()[0]!.invocation));
 const result=await kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}});
 assert.equal(result.status,"success");assert.equal(calls(),1);assert.equal(kit.listDeferredApprovals().length,0);
 await assert.rejects(()=>kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}}),e=>e instanceof ToolError&&e.code==="approval_required");
 assert.equal(calls(),1);
});
test("changed input, names and narrowed selections cannot reuse an approval",async t=>{
 const {kit,calls}=fixture(t);
 for(const call of [{name:"test.deferred",input:{target:"two"}},{name:"test.other",input:{target:"one"}}]) {
  const requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
  await assert.rejects(()=>kit.resumeApproval(requestId,{outcome:"allow"},call),e=>e instanceof ToolError&&e.code==="permission_denied");
 }
 const requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 const result=await kit.select({name:[]}).resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}});
 assert.equal(result.status==="error"&&result.error.code,"permission_denied");assert.equal(calls(),0);
});
test("denial cannot execute even after policy relaxation; changing policy invalidates an allow",async t=>{
 const {kit,calls}=fixture(t,{policy:{approvals:{"test.deferred":"always"}}});
 let requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 kit._state.policy.approvals["test.deferred"]="never";
 const denial=await kit.resumeApproval(requestId,{outcome:"deny"},{name:"test.deferred",input:{target:"one"}});
 assert.equal(denial.status==="error"&&denial.error.code,"permission_denied");
 kit._state.policy.approvals["test.deferred"]="always";
 requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 kit._state.policy.approvals["test.deferred"]="never";
 const changed=await kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}});
 assert.equal(changed.status==="error"&&changed.error.code,"permission_denied");assert.equal(calls(),0);
});
test("cancellation consumes a resume ticket without executing",async t=>{
 const {kit,calls}=fixture(t);
 const requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 const controller=new AbortController();controller.abort();
 const result=await kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"},signal:controller.signal});
 assert.equal(result.status==="error"&&result.error.code,"cancelled");assert.equal(calls(),0);assert.equal(kit.listDeferredApprovals().length,0);
});
test("deferred storage evicts old entries, prunes expiry and supports explicit discard",()=>{
 const manager=new ApprovalManager({redactor:createRedactor({secrets:[]})});
 assert.throws(()=>new DeferredApprovals(0),/positive safe integer/);
 const store=new DeferredApprovals(2);
 const make=()=>manager.createRequest({name:"test",version:"1"},{},{sideEffect:"destructive",risk:"high",capabilities:[]},"fixture","trace");
 const a=make(),b=make(),c=make();store.add(a);store.add(b);store.add(c);
 assert.equal(store.take(a.id),undefined);assert.equal(store.list().length,2);
 assert.equal(store.discard(b.id),true);assert.equal(store.discard(b.id),false);
 const expired={...make(),expiresAt:0};store.add(expired);assert.equal(store.take(expired.id),undefined);
 assert.equal(store.list().length,1);
});

test("non-interactive approval_required IDs are actually resumable without re-exposing tools",async t=>{
 const {kit,calls}=fixture(t);
 const requestId=id(await kit.invoke("test.deferred",{target:"one"}));
 assert.equal(kit.listDeferredApprovals()[0]?.id,requestId);
 const result=await kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}});
 assert.equal(result.status,"success");assert.equal(calls(),1);
});
test("expired tickets cannot resume a real invocation",async t=>{
 const {kit,calls}=fixture(t);
 const requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 const expires=kit.listDeferredApprovals()[0]!.expiresAt;
 t.mock.method(Date,"now",()=>expires+1);
 await assert.rejects(()=>kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}}),/expired/);
 assert.equal(calls(),0);
});
test("changed classification cannot inherit a prior input-only approval",async t=>{
 const {kit,tool,calls}=fixture(t,{policy:{approvals:{"test.deferred":"always"}}});
 let sideEffect:"write"|"destructive"="write";
 tool.classify=()=>({sideEffect,risk:"low",capabilities:[]});
 const requestId=id(await kit.invoke("test.deferred",{target:"one"},{deferApproval:true}));
 sideEffect="destructive";
 const result=await kit.resumeApproval(requestId,{outcome:"allow"},{name:"test.deferred",input:{target:"one"}});
 assert.equal(result.status==="error"&&result.error.code,"permission_denied");assert.equal(calls(),0);
});

test("native approval preparation never executes ungated tools and shares runtime validation",async t=>{
 const {kit,calls}=fixture(t);
 assert.throws(()=>kit.prepareApproval("test.deferred",{target:1}),e=>e instanceof ToolError&&e.code==="validation");
 const request=kit.prepareApproval("test.deferred",{target:"one"});assert.ok(request?.id);assert.equal(calls(),0);
 kit._state.policy.approvals["test.deferred"]="never";
 assert.equal(kit.prepareApproval("test.deferred",{target:"one"}),null);assert.equal(calls(),0);
 assert.throws(()=>kit.select({name:[]}).prepareApproval("test.deferred",{target:"one"}),e=>e instanceof ToolError&&e.code==="permission_denied");
});
