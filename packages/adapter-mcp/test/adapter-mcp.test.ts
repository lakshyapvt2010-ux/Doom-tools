import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defineTool } from "@agentic-tools/core";
import { createToolkit, type Toolkit } from "@agentic-tools/runtime";
import { allowAllApprover, cliApprover } from "@agentic-tools/security";
import { createMcpServer, exposedTools, toolNeedsApproval } from "../src/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

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

function makeToolkit(extra: Record<string, unknown> = {}): Toolkit {
  return createToolkit({
    workspace: mkdtempSync(join(tmpdir(), "at-mcp-")),
    tools: [readTool as never, dangerTool as never],
    ...extra
  } as Parameters<typeof createToolkit>[0]);
}

async function connect(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

test("list exposes tools; calls pass through the runtime", async () => {
  const toolkit = makeToolkit();
  const server = createMcpServer(toolkit);
  const client = await connect(server);
  const { tools } = await client.listTools();
  // danger tool hidden: client has no elicitation, toolkit has no approver
  assert.deepEqual(tools.map((t) => t.name), ["test.read"]);

  const result = await client.callTool({ name: "test.read", arguments: { q: "x" } });
  const structured = result.structuredContent as { status: string; output: string };
  assert.equal(structured.status, "success");
  assert.equal(structured.output, "read:x");
  await client.close();
});

test("approval-gated tools are hidden without elicitation or an out-of-band approver (FR-012)", async () => {
  const toolkit = makeToolkit();
  const server = createMcpServer(toolkit);
  assert.equal(toolNeedsApproval(toolkit, dangerTool as never), true);
  assert.equal(toolNeedsApproval(toolkit, readTool as never), false);
  // server not yet connected: no client caps, no out-of-band approver
  assert.deepEqual(exposedTools(toolkit, null).map((t) => t.name), ["test.read"]);

  const withApprover = makeToolkit({ approvers: [allowAllApprover()] });
  assert.deepEqual(exposedTools(withApprover, null).map((t) => t.name).sort(), [
    "test.danger",
    "test.read"
  ]);
});

test("a guessed non-exposed tool name is permission_denied, never executed (FR-019)", async () => {
  const toolkit = makeToolkit();
  const server = createMcpServer(toolkit);
  const client = await connect(server);
  const result = await client.callTool({ name: "test.danger", arguments: {} });
  assert.equal(result.isError, true);
  const structured = result.structuredContent as { status: string; error: { code: string } };
  assert.equal(structured.error.code, "permission_denied");
  const hallucinated = await client.callTool({ name: "nope.nope", arguments: {} });
  const hs = hallucinated.structuredContent as { error: { code: string } };
  assert.equal(hs.error.code, "permission_denied");
  await client.close();
});

test("approval flows through an out-of-band approver when client cannot elicit", async () => {
  const toolkit = makeToolkit({ approvers: [allowAllApprover()] });
  const server = createMcpServer(toolkit);
  const client = await connect(server);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 2); // exposed because the toolkit has an approver
  const result = await client.callTool({ name: "test.danger", arguments: {} });
  const structured = result.structuredContent as { status: string; output: string };
  assert.equal(structured.status, "success");
  assert.equal(structured.output, "boom");
  await client.close();
});

test("no approver anywhere yields approval_required, never auto-approved (FR-006)", async () => {
  // Force exposure by giving a deny-all-shaped path: hide check needs an approver,
  // so instead call through a toolkit with an approver-less server via direct invoke.
  const toolkit = makeToolkit();
  const res = await toolkit.invoke("test.danger", {});
  assert.equal(res.status, "error");
  if (res.status === "error") assert.equal(res.error.code, "approval_required");
});

test("invalid arguments fail with stable validation code through MCP (FR-002)", async () => {
  const toolkit = makeToolkit();
  const server = createMcpServer(toolkit);
  const client = await connect(server);
  const result = await client.callTool({ name: "test.read", arguments: { q: 42 } });
  assert.equal(result.isError, true);
  const structured = result.structuredContent as { error: { code: string } };
  assert.equal(structured.error.code, "validation");
  await client.close();
});

test("a stdio-prompting approver is not an out-of-band path for exposure", () => {
  // cliApprover prompts on the very streams the stdio transport owns, so
  // it can never present a request to an MCP client. Counting it would
  // expose approval-gated tools that nobody could approve.
  const toolkit = makeToolkit({ approvers: [cliApprover()] });
  assert.deepEqual(exposedTools(toolkit, null).map((t) => t.name), ["test.read"]);
  // A genuinely out-of-band approver (callback, file queue) still counts.
  const outOfBand = makeToolkit({ approvers: [allowAllApprover()] });
  assert.deepEqual(
    exposedTools(outOfBand, null).map((t) => t.name).sort(),
    ["test.danger", "test.read"]
  );
});
