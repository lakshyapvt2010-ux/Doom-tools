import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStructuredTool } from "@langchain/core/tools";
import { ToolError, defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { ToolExecutionError, toLangChain } from "../src/index.js";

const readTool = defineTool({
  name: "test.read",
  description: "reads",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
  sideEffect: "read",
  execute: async ({ q }: { q?: string }) => `read:${q ?? ""}`
});

const dangerTool = defineTool({
  name: "test.danger",
  description: "destructive",
  inputSchema: { type: "object" },
  sideEffect: "destructive",
  risk: "high",
  capabilities: [],
  execute: async () => "boom"
});

function makeToolkit() {
  return createToolkit({
    workspace: mkdtempSync(join(tmpdir(), "at-langchain-")),
    tools: [readTool as never, dangerTool as never]
  });
}

test("tools become real LangChain structured tools and execute through the runtime", async () => {
  const tools = toLangChain(makeToolkit());
  assert.deepEqual(tools.map((t) => t.name).sort(), ["test.danger", "test.read"]);
  for (const t of tools) assert.ok(isStructuredTool(t), t.name);
  const read = tools.find((t) => t.name === "test.read")!;
  assert.equal(read.description, "reads");
  const out = await read.invoke({ q: "hi" });
  assert.equal(JSON.parse(out as string), "read:hi");
});

test("failures throw with stable codes preserved (PRD 10.2)", async () => {
  const missingTool = defineTool({
    name: "test.read",
    description: "reads",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    sideEffect: "read",
    execute: async ({ q }: { q?: string }) => {
      if (q === "missing") throw new ToolError("not_found", "no such item");
      return `read:${q ?? ""}`;
    }
  });
  const toolkit = createToolkit({
    workspace: mkdtempSync(join(tmpdir(), "at-langchain-")),
    tools: [missingTool as never]
  });
  const [read] = toLangChain(toolkit);
  // Schema-valid input that fails in the runtime keeps its stable code.
  await assert.rejects(
    () => read!.invoke({ q: "missing" }),
    (err: unknown) => {
      assert.ok(err instanceof ToolExecutionError);
      assert.equal(err.code, "not_found");
      return true;
    }
  );
  // Framework parsing errors are normalized without executing the callback.
  await assert.rejects(() => read!.invoke({ q: 1 }),
    (e: unknown) => e instanceof ToolExecutionError && e.code === "validation");
});

test("approval is never skipped: gated calls surface approval_required (PRD 9.5)", async () => {
  const tools = toLangChain(makeToolkit());
  const danger = tools.find((t) => t.name === "test.danger")!;
  await assert.rejects(
    () => danger.invoke({}),
    (err: unknown) => {
      assert.ok(err instanceof ToolExecutionError);
      assert.equal(err.code, "approval_required");
      return true;
    }
  );
});

test("returnEnvelope mode hands back the structured result", async () => {
  const tools = toLangChain(makeToolkit(), { returnEnvelope: true });
  const danger = tools.find((t) => t.name === "test.danger")!;
  const res = JSON.parse((await danger.invoke({})) as string) as { status: string; error: { code: string } };
  assert.equal(res.status, "error");
  assert.equal(res.error.code, "approval_required");
});

test("non-exposed tools cannot be called through the adapter (FR-019)", async () => {
  const toolkit = makeToolkit();
  const narrowed = toolkit.select({ name: "test.read" });
  const tools = toLangChain(narrowed);
  assert.deepEqual(tools.map((t) => t.name), ["test.read"]);
});

test("provider name mapping keeps canonical runtime identity and rejects collisions", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-lc-names-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const one = defineTool({ name: "read.one", description: "Read one", inputSchema: { type: "object" }, sideEffect: "read", execute: async () => "one" });
  const two = defineTool({ ...one, name: "read.two", execute: async () => "two" });
  const toolkit = createToolkit({ workspace, tools: [one, two] });
  const tools = toLangChain(toolkit, { returnEnvelope: true, nameForTool: (name) => name.replaceAll(".", "_") });
  assert.deepEqual(tools.map((x) => x.name), ["read_one", "read_two"]);
  const out = JSON.parse((await tools[0]!.invoke({})) as string) as { tool: { name: string } };
  assert.equal(out.tool.name, one.name);
  assert.throws(() => toLangChain(toolkit, { nameForTool: () => "same" }), /unique/);
});

test("caller cancellation reaches the runtime", async () => {
  const controller = new AbortController();
  controller.abort();
  const read = toLangChain(makeToolkit()).find(t => t.name === "test.read")!;
  await assert.rejects(() => read.invoke({}, { signal: controller.signal }));
});

test("LangGraph ToolNode runs selected tools and keeps runtime approval failures", async () => {
 const { ToolNode } = await import("@langchain/langgraph/prebuilt");
 const { AIMessage } = await import("@langchain/core/messages");
 const node=new ToolNode(toLangChain(makeToolkit(), {nameForTool:n=>n.replaceAll('.', '_')}), {handleToolErrors:false});
 const output=await node.invoke({messages:[new AIMessage({content:"", tool_calls:[{name:"test_read",args:{q:"graph"},id:"local-call",type:"tool_call"}]})]});
 assert.equal(JSON.parse(output.messages[0]!.content as string),"read:graph");
 await assert.rejects(()=>node.invoke({messages:[new AIMessage({content:"",tool_calls:[{name:"test_danger",args:{},id:"danger-call",type:"tool_call"}]})]}), (e:unknown)=>e instanceof ToolExecutionError && e.code==='approval_required');
});

test("default model rendering retains runtime truncation markers", async t => {
 const workspace=mkdtempSync(join(tmpdir(),"at-lc-cut-"));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 const output=defineTool({name:"test.large",description:"Large output",inputSchema:{type:"object"},sideEffect:"read",execute:async()=>"x".repeat(1000)});
 const toolkit=createToolkit({workspace,tools:[output],policy:{budgets:{maxOutputBytes:20}}});
 const result=JSON.parse(await toLangChain(toolkit)[0]!.invoke({}) as string);
 assert.equal(result.status,"success");assert.equal(result.truncation?.truncated,true);assert.match(result.truncation?.continuation,/Re-invoke/);
});
