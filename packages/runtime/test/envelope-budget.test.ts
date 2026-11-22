import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, failure, success, ToolError, type ToolResult } from "@agentic-tools/core";
import { createToolkit } from "../src/toolkit.js";
import { boundResult } from "../src/envelope.js";
const ref = {name: "test.envelope", version: "1"};
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function setup(t: any, execute: () => Promise<unknown>, options: Record<string, any> = {}) {
 const workspace = mkdtempSync(join(tmpdir(), "at-envelope-"));
 t.after(() => rmSync(workspace, {recursive:true, force:true}));
 return createToolkit({workspace, tools: [defineTool({...ref, description:"Envelope fixture", inputSchema:{type:"object"}, sideEffect:"read", execute})], ...options});
}
test("whole-result default also bounds errors, metadata and warnings", async t => {
 for (const execute of [
  async () => failure(ref, {code:"provider_error", message:"secret-free".repeat(20000), details:{huge:"x".repeat(100000)}}),
  async () => success(ref, "ok", {warnings:["x".repeat(100000)], metadata:{big:"z".repeat(100000)}})
 ]) {
  const result = await setup(t, execute).invoke(ref.name, {});
  assert.ok(bytes(result) <= 65536);
  assert.equal(result.status,"error");
  assert.equal(result.truncation?.truncated,true);
  assert.match(result.truncation?.continuation ?? "", /smaller page/);
 }
});
test("complete-result limits measure all fields, not only successful output", async t => {
 const kit=setup(t,async()=>"x".repeat(1000),{policy:{budgets:{maxOutputBytes:2000,maxResultBytes:900}}});
 const result=await kit.invoke(ref.name,{});
 assert.ok(bytes(result)<=900);
 assert.equal(result.status==="error"&&result.error.code,"resource_limit");
 assert.equal(kit.traceRecords()[0]?.errorCode,"resource_limit");
 assert.equal(kit.auditEvents().at(-1)?.type,"invocation.end");
});
test("oversized errors preserve stable error codes without their huge details", async t => {
 const kit=setup(t,async()=>failure(ref,{code:"permission_denied",message:"z".repeat(10000)}),{policy:{budgets:{maxResultBytes:900}}});
 const result=await kit.invoke(ref.name,{});
 assert.equal(result.status==="error"&&result.error.code,"permission_denied");
 assert.ok(bytes(result)<=900);
});
test("a sink that fails only on the end event cannot overflow the final envelope", async t => {
 const kit=setup(t,async()=>"x".repeat(600),{policy:{budgets:{maxResultBytes:900}},auditSinks:[{record(event:any){if(event.type==="invocation.end")throw Error("unavailable");}}]});
 const result=await kit.invoke(ref.name,{});
 assert.ok(bytes(result)<=900);
 assert.match(result.warnings?.at(-1)??"",/audit sink failed/);
 assert.equal(kit.traceRecords()[0]?.status,result.status);
});
test("impossible full-envelope budgets reject before execution or approval", async t => {
 let calls=0,approvals=0;
 const kit=setup(t,async()=>{calls++;return "ok";},{policy:{approvals:{[ref.name]:"always"},budgets:{maxResultBytes:10}},approvers:[{name:"fixture",approve:async()=>{approvals++;return {outcome:"allow"};}}]});
 await assert.rejects(()=>kit.invoke(ref.name,{}),e=>e instanceof ToolError&&e.code==="resource_limit");
 assert.equal(calls,0);assert.equal(approvals,0);
});
test("per-tool complete caps only narrow toolkit caps; token counts cover the full result", async t => {
 const kit=setup(t,async()=>"€".repeat(1000),{policy:{budgets:{maxResultBytes:1200,maxResultTokens:1000,perTool:{[ref.name]:{maxResultBytes:10000,maxResultTokens:800}}}},runtime:{countOutputTokens:(s:string)=>s.length}});
 const result=await kit.invoke(ref.name,{});
 assert.ok(bytes(result)<=1200);assert.ok(JSON.stringify(result).length<=800);
 const narrower=setup(t,async()=>"x".repeat(1000),{policy:{budgets:{maxResultBytes:10000,perTool:{[ref.name]:{maxResultBytes:900}}}}});
 assert.ok(bytes(await narrower.select({name:ref.name}).invoke(ref.name,{}))<=900);
});
test("serialization failures still pass through the whole-result limiter", async t => {
 const kit=setup(t,async()=>1n,{policy:{budgets:{maxResultBytes:900}}});
 const result=await kit.invoke(ref.name,{});
 assert.equal(result.status==="error"&&result.error.code,"execution_error");
 assert.ok(bytes(result)<=900);
});
test("non-monotonic token counters check actual as well as reserved-warning rendering", () => {
 const result=success(ref,"test");
 const counter=(s:string)=>s.includes('"output"')&&!s.includes('"warnings"')?10000:s.length;
 const bounded=boundResult(result,{maxResultBytes:10000,maxResultTokens:1000},counter);
 assert.ok(counter(JSON.stringify(bounded))<=1000);
 assert.equal(bounded.status,"error");
 assert.throws(()=>boundResult(result,{maxResultBytes:10000,maxResultTokens:1000},()=>NaN),/Invalid complete-result/);
});
test("oversized correlation identity fails before any tool can execute", async t => {
 let calls=0;
 const kit=setup(t,async()=>{calls++;return "ok";},{policy:{budgets:{maxResultBytes:900}}});
 await assert.rejects(()=>kit.invoke(ref.name,{}, {traceId:"x".repeat(10000)}),/cannot fit/);
 assert.equal(calls,0);
});

test("standalone whole-envelope shaping rejects invalid limits and hides tokenizer exceptions", () => {
 for(const maxResultBytes of [NaN,Infinity,0,-1,1.5]) assert.throws(()=>boundResult(success(ref,"x"),{maxResultBytes}),/positive safe integers/);
 assert.throws(()=>boundResult(success(ref,"x"),{maxResultBytes:1000,maxResultTokens:1000},()=>{throw Error("private host text");}),e=>e instanceof ToolError && e.message==="Complete-result token counter failed.");
});

test("host transport serializer counts wrapping and escape expansion before audit", async t => {
 const encode=(result:ToolResult)=>JSON.stringify({content:JSON.stringify(result),structured:result});
 const kit=setup(t,async()=> '"\\'.repeat(500),{policy:{budgets:{maxOutputBytes:10000,maxResultBytes:2400}}});
 const result=await kit.invoke(ref.name,{}, {encodeResult:encode});
 assert.ok(Buffer.byteLength(encode(result))<=2400);
 assert.equal(result.status==="error"&&result.error.code,"resource_limit");
 assert.equal(kit.traceRecords()[0]?.errorCode,"resource_limit");
});
test("invalid or impossible transport serializers reject before execution", async t => {
 let calls=0;
 const kit=setup(t,async()=>{calls++;return "ok";});
 for(const encodeResult of [()=>{throw Error("private host text");},()=>"x".repeat(100000)]) {
  await assert.rejects(()=>kit.invoke(ref.name,{}, {encodeResult}),e=>e instanceof ToolError&&e.code==="resource_limit"&&!e.message.includes("private host text"));
 }
 assert.equal(calls,0);
});

test("void results retain a valid output field on the wire; functions cannot masquerade as JSON output", async t => {
 const kit=setup(t,async()=>undefined);
 const result=await kit.invoke(ref.name,{});
 assert.equal(result.status,"success");
 assert.deepEqual((JSON.parse(JSON.stringify(result)) as {output:unknown}).output,null);
 const invalid=setup(t,async()=>function notJson(){});
 const failed=await invalid.invoke(ref.name,{});
 assert.equal(failed.status==="error"&&failed.error.code,"execution_error");
});
