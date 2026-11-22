import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, RunContext } from "@openai/agents";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { toOpenAIAgents, ToolExecutionError } from "../src/index.js";

const read = defineTool({ name: "test.read", description: "Read", inputSchema: { type: "object", properties: { q: { type: "string" } }, additionalProperties: false }, sideEffect: "read", execute: async ({q}: {q?: string}) => ({value: q ?? "default"}) });
const danger = defineTool({ name: "test.danger", description: "Danger", inputSchema: {type: "object"}, sideEffect: "destructive", risk: "high", execute: async () => "boom" });
const kit = () => createToolkit({workspace: mkdtempSync(join(tmpdir(), "at-oa-")), tools: [read as never, danger as never]});
const context = () => new RunContext();

test("real SDK tools fit Agent and invoke through runtime without a provider", async () => {
 const tools=toOpenAIAgents(kit());
 const agent=new Agent({ name: "Local test", tools });
 assert.equal(agent.tools.length,2);
 assert.equal(tools.find(t=>t.name==='test_read')!.type,"function");
 assert.equal(tools.find(t=>t.name==='test_read')!.strict,false);
 assert.deepEqual(JSON.parse(await tools.find(t=>t.name==='test_read')!.invoke(context(), '{"q":"hi"}')), {value:"hi"});
 assert.deepEqual(JSON.parse(await tools.find(t=>t.name==='test_read')!.invoke(context(), '{}')), {value:"default"});
});
test("runtime validation keeps stable errors", async () => {
 const t=toOpenAIAgents(kit()).find(t=>t.name==='test_read');
 await assert.rejects(()=>t!.invoke(context(), '{"q":1}'), (e:unknown)=>e instanceof ToolExecutionError && e.code==='validation');
});
test("approval cannot be bypassed", async () => {
 const tools=toOpenAIAgents(kit());
 await assert.rejects(()=>tools.find(t=>t.name==='test_danger')!.invoke(context(), '{}'), (e:unknown)=>e instanceof ToolExecutionError && e.code==='approval_required');
});
test("envelope mode preserves canonical name and failure", async () => {
 const tools=toOpenAIAgents(kit(), {returnEnvelope:true});
 const result=JSON.parse(await tools.find(t=>t.name==='test_danger')!.invoke(context(), '{}'));
 assert.equal(result.tool.name,'test.danger'); assert.equal(result.error.code,'approval_required');
});
test("selection and name collision checks", () => {
 assert.equal(toOpenAIAgents(kit().select({name:'test.read'})).length,1);
 assert.throws(()=>toOpenAIAgents(kit(),{nameForTool:()=> 'same'}), /unique/);
 assert.throws(()=>toOpenAIAgents(kit(),{nameForTool:()=> 'bad.name'}), /provider-safe/);
});
test("caller cancellation is forwarded", async () => {
 const controller=new AbortController(); controller.abort();
 const t=toOpenAIAgents(kit()).find(t=>t.name==='test_read');
 await assert.rejects(()=>t!.invoke(context(), '{}', {signal:controller.signal}), (e:unknown)=> e instanceof ToolExecutionError && e.code==='cancelled');
});

test("real Runner executes a tool loop with a local scripted model", async () => {
 const { Runner } = await import("@openai/agents");
 const { ScriptedModel, functionCall, assistantMessage } = await import("@openai/agents/testing");
 const model = new ScriptedModel([
  [functionCall("test_read", {q:"runner"}, {callId:"call-local"})],
  [assistantMessage("done")]
 ]);
 const toolkit=kit();
 const agent=new Agent({name:"Local runner", tools:toOpenAIAgents(toolkit), model});
 const result=await new Runner({tracingDisabled:true}).run(agent,"Run the read tool.");
 assert.equal(result.finalOutput,"done");
 model.assertComplete();
 assert.equal(model.calls.length,2);
 const request=JSON.stringify(model.calls[1]!.request.input);
 assert.match(request,/runner/);
 assert.match(request,/value/);
});

test("default model rendering retains runtime truncation markers", async () => {
 const output=defineTool({name:"test.large",description:"Large output",inputSchema:{type:"object"},sideEffect:"read",execute:async()=>"x".repeat(1000)});
 const toolkit=createToolkit({workspace:mkdtempSync(join(tmpdir(),"at-oa-cut-")),tools:[output],policy:{budgets:{maxOutputBytes:20}}});
 const result=JSON.parse(await toOpenAIAgents(toolkit)[0]!.invoke(context(),'{}'));
 assert.equal(result.status,"success");assert.equal(result.truncation?.truncated,true);assert.match(result.truncation?.continuation,/Re-invoke/);
});
