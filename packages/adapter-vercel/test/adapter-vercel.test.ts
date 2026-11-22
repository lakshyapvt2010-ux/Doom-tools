import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { ToolExecutionError, toVercelAI } from "../src/index.js";

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
    workspace: mkdtempSync(join(tmpdir(), "at-vercel-")),
    tools: [readTool as never, dangerTool as never]
  });
}

test("tools map to the AI SDK shape and execute through the runtime", async () => {
  const tools = toVercelAI(makeToolkit());
  assert.deepEqual(Object.keys(tools).sort(), ["test.danger", "test.read"]);
  const out = await tools["test.read"]?.execute({ q: "hi" });
  assert.equal(out, "read:hi");
});

test("failures throw with stable codes preserved (PRD 10.2)", async () => {
  const tools = toVercelAI(makeToolkit());
  const tool = tools["test.read"];
  assert.ok(tool);
  await assert.rejects(
    () => tool.execute({ q: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof ToolExecutionError);
      assert.equal(err.code, "validation");
      return true;
    }
  );
});

test("approval is never skipped: gated calls surface approval_required (PRD 9.5)", async () => {
  const tools = toVercelAI(makeToolkit());
  const danger = tools["test.danger"];
  assert.ok(danger);
  await assert.rejects(
    () => danger.execute({}),
    (err: unknown) => {
      assert.ok(err instanceof ToolExecutionError);
      assert.equal(err.code, "approval_required");
      return true;
    }
  );
});

test("returnEnvelope mode hands back the structured result", async () => {
  const tools = toVercelAI(makeToolkit(), { returnEnvelope: true });
  const danger = tools["test.danger"];
  assert.ok(danger);
  const res = (await danger.execute({})) as { status: string; error: { code: string } };
  assert.equal(res.status, "error");
  assert.equal(res.error.code, "approval_required");
});

test("non-exposed tools cannot be called through the adapter (FR-019)", async () => {
  const toolkit = makeToolkit();
  const narrowed = toolkit.select({ name: "test.read" });
  const tools = toVercelAI(narrowed);
  assert.deepEqual(Object.keys(tools), ["test.read"]);
});
