import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@agentic-tools/adapter-mcp";
import { toVercelAI } from "@agentic-tools/adapter-vercel";
import { createToolkit } from "@agentic-tools/runtime";
import { defineTool, type ToolResult } from "@agentic-tools/core";

for (const route of ["mcp", "vercel"] as const) {
  test(`${route} caller abort reaches the runtime and cooperative tool`, { timeout: 5000 }, async (t) => {
    const workspace = mkdtempSync(join(tmpdir(), "at-adapter-cancel-"));
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    let markStarted!: () => void;
    let markStopped!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const stopped = new Promise<void>((resolve) => { markStopped = resolve; });
    const slow = defineTool({ name: "test.cancel", description: "Cooperative cancellation fixture",
      sideEffect: "read", inputSchema: { type: "object" },
      execute: async (_input, context) => new Promise<never>(() => {
        context.signal.addEventListener("abort", markStopped, { once: true });
        markStarted();
      }) });
    const toolkit = createToolkit({ workspace, tools: [slow] });
    const controller = new AbortController();
    let resultPromise: Promise<unknown>;
    if (route === "mcp") {
      const server = createMcpServer(toolkit);
      const client = new Client({ name: "cancel-test", version: "1" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      t.after(async () => { await client.close(); await server.close(); });
      resultPromise = client.callTool({ name: slow.name, arguments: {} }, undefined, { signal: controller.signal });
    } else {
      resultPromise = toVercelAI(toolkit, { returnEnvelope: true })[slow.name]!.execute({}, { abortSignal: controller.signal });
    }
    // Attach a rejection handler before sending cancellation, since a wire
    // protocol may reject locally rather than deliver the cancelled envelope.
    const settled = resultPromise.then((value) => value, (error) => error);
    await started;
    controller.abort();
    await stopped;
    const result = await settled;
    if (route === "vercel") assert.equal((result as ToolResult).status === "error" && (result as { error: { code: string } }).error.code, "cancelled");
    // Give the server request handler one turn to record its terminal event.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(toolkit.traceRecords()[0]?.errorCode, "cancelled");
    assert.equal(toolkit.metrics()[0]?.count, 1);
  });
}

test("MCP never falls through to a stdio approver after an unavailable out-of-band approver", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-stdio-gate-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  let prompted = false;
  const read = defineTool({ name: "test.read", description: "Read fixture", sideEffect: "read", inputSchema: { type: "object" }, execute: async () => "ok" });
  const toolkit = createToolkit({ workspace, tools: [read],
    policy: { approvals: { [read.name]: "always" } },
    approvers: [
      { name: "stdio-fixture", usesStdio: true, async approve() { prompted = true; return { outcome: "allow" }; } },
      { name: "out-of-band-unavailable", async approve() { return null; } }
    ] });
  const server = createMcpServer(toolkit);
  const client = new Client({ name: "stdio-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  assert.equal((await client.listTools()).tools.length, 1);
  const result = (await client.callTool({ name: read.name, arguments: {} })).structuredContent as unknown as ToolResult;
  assert.equal(result.status === "error" && result.error.code, "approval_required");
  assert.equal(prompted, false);
  assert.equal(toolkit.traceRecords().length, 1);
});
