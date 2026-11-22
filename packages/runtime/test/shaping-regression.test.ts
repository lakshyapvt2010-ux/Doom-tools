import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { success, defineTool } from "@agentic-tools/core";
import { createToolkit } from "../src/toolkit.js";
import { shapeResult } from "../src/shaping.js";

const ref = { name: "test.output", version: "1" };
test("UTF-8 truncation never cuts a code point or miscounts omitted bytes", () => {
  const result = shapeResult(success(ref, "€€€"), 5);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.output, "€");
    assert.equal(result.truncation?.omitted, 6);
    assert.ok(!result.output.includes("\ufffd"));
  }
});

test("runtime shortening never returns a cursor past omitted page items", () => {
  const result = shapeResult(success(ref, { items: Array.from({ length: 8 }, (_, i) => "entry-" + i), nextCursor: "past-all-eight" }), 80);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.ok(result.output.items.length < 8);
    assert.equal("nextCursor" in result.output, false);
    assert.match(result.truncation?.continuation ?? "", /SAME input cursor/);
  }
});

test("a non-serializable tool result still gets a safe terminal trace", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-output-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const tool = defineTool({ name: "test.bigint", description: "Invalid output fixture", inputSchema: { type: "object" }, sideEffect: "read", execute: async () => 1n });
  const toolkit = createToolkit({ workspace, tools: [tool] });
  const result = await toolkit.invoke(tool.name, {});
  assert.equal(result.status === "error" && result.error.code, "execution_error");
  assert.equal(toolkit.traceRecords().length, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("failed optional audit sink is visible without losing the memory audit or result", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-audit-sink-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const tool = defineTool({ name: "test.audit", description: "Audit failure fixture", inputSchema: { type: "object" }, sideEffect: "read", execute: async () => "ok" });
  const toolkit = createToolkit({ workspace, tools: [tool], auditSinks: [{ record() { throw new Error("sink unavailable"); } }] });
  const result = await toolkit.invoke(tool.name, {});
  assert.equal(result.status, "success");
  assert.match(result.warnings?.[0] ?? "", /audit sink failed/);
  assert.equal(toolkit.auditEvents().filter((event) => event.type === "invocation.end").length, 1);
  assert.equal(toolkit.traceRecords().length, 1);
});

test("serialized payload caps count JSON escaping and preview overhead", () => {
  for (const value of ['"\\\n'.repeat(1000), {nested:'"\\'.repeat(1000)}, Array.from({length:100},()=> '"'.repeat(50))]) {
    const r=shapeResult(success(ref,value),100);
    assert.equal(r.status,'success');
    if(r.status==='success') {assert.ok(Buffer.byteLength(JSON.stringify(r.output),'utf8')<=100);assert.equal(r.truncation?.truncated,true);}
  }
});
test("token budgets use the host counter, not a provider-specific guess", () => {
  const count=(s:string)=>Array.from(s).length;
  const r=shapeResult(success(ref,'€'.repeat(100)),1000,12,count);
  assert.equal(r.status,'success');
  if(r.status==='success') assert.ok(count(JSON.stringify(r.output))<=12);
  assert.throws(()=>shapeResult(success(ref,'hello'),1000,2,()=>NaN),/Invalid token/);
});
test("impossible payload budgets fail clearly rather than emit oversize previews", () => {
 const r=shapeResult(success(ref,{big:'x'.repeat(100)}),1);
 assert.equal(r.status==='error'&&r.error.code,'resource_limit');
});
test("per-tool caps narrow but cannot widen toolkit byte/token budgets", async () => {
 const tool=defineTool({name:'test.budget',description:'budget',inputSchema:{type:'object'},sideEffect:'read',execute:async()=> 'x'.repeat(1000)});
 const toolkit=createToolkit({workspace:mkdtempSync(join(tmpdir(),'at-budget-')),tools:[tool],policy:{budgets:{maxOutputBytes:100,maxOutputTokens:80,perTool:{'test.budget':{maxOutputBytes:1000,maxOutputTokens:20}}}},runtime:{countOutputTokens:s=>s.length}});
 const r=await toolkit.select({name:tool.name}).invoke(tool.name,{});
 assert.equal(r.status,'success');
 if(r.status==='success') assert.ok(JSON.stringify(r.output).length<=20);
 const narrower=createToolkit({workspace:toolkit.workspace,tools:[tool],policy:{budgets:{maxOutputBytes:1000,perTool:{'test.budget':{maxOutputBytes:30}}}}});
 const n=await narrower.invoke(tool.name,{});
 if(n.status==='success') assert.ok(Buffer.byteLength(JSON.stringify(n.output))<=30); else assert.fail('Expected shaped output');
});
test("invalid output budget configuration is rejected before execution", () => {
 for(const maxOutputBytes of [NaN,Infinity,0,-1,1.5]) assert.throws(()=>createToolkit({workspace:mkdtempSync(join(tmpdir(),'at-bad-budget-')),tools:[],policy:{budgets:{maxOutputBytes}}}),/positive safe integers/);
});
