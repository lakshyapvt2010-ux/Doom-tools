import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { serveMcpHttp } from "../src/index.js";

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
const toolkit = () =>
  createToolkit({ workspace: mkdtempSync(join(tmpdir(), "at-mcph-")), tools: [readTool as never, dangerTool as never] } as never);

const init = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } }
};
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body)
  });

test("a real SDK client lists and calls tools over Streamable HTTP through the runtime", async () => {
  const h = await serveMcpHttp(toolkit());
  try {
    const client = new Client({ name: "c", version: "0" }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(h.url)));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["test.read"]); // danger hidden: no approval path
    const r = await client.callTool({ name: "test.read", arguments: { q: "x" } });
    assert.equal((r.structuredContent as { output: string }).output, "read:x");
    const denied = await client.callTool({ name: "test.danger", arguments: {} });
    assert.equal((denied.structuredContent as { status: string }).status, "error");
    assert.equal(h.sessions(), 1);
    await client.close();
  } finally { await h.close(); }
});

test("binds to loopback by default and refuses non-loopback bind without a token", async () => {
  const h = await serveMcpHttp(toolkit());
  try { assert.match(h.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/); } finally { await h.close(); }
  await assert.rejects(serveMcpHttp(toolkit(), { host: "0.0.0.0" }));
  await assert.rejects(serveMcpHttp(toolkit(), { host: "0.0.0.0", authToken: "short" }));
});

test("rejects foreign Origin and Host headers (DNS rebinding defense)", async () => {
  const h = await serveMcpHttp(toolkit());
  try {
    const origin = await post(h.url, init, { origin: "https://evil.example" });
    assert.equal(origin.status, 403);
    const ok = await post(h.url, init, { origin: "http://localhost:3000" });
    assert.equal(ok.status, 200);
    // Host header spoof via raw request
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      const req = request(h.url, { method: "POST", headers: { host: "evil.example", "content-type": "application/json", accept: "application/json, text/event-stream" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.end(JSON.stringify(init));
    });
    assert.equal(status, 403);
  } finally { await h.close(); }
});

test("bearer token is required when configured", async () => {
  const token = "0123456789abcdef-token";
  const h = await serveMcpHttp(toolkit(), { authToken: token });
  try {
    assert.equal((await post(h.url, init)).status, 401);
    assert.equal((await post(h.url, init, { authorization: "Bearer wrong-wrong-wrong-wrong" })).status, 401);
    assert.equal((await post(h.url, init, { authorization: `Bearer ${token}` })).status, 200);
  } finally { await h.close(); }
});

test("requests without a session, unknown sessions, wrong paths, oversize bodies and bad JSON are rejected", async () => {
  const h = await serveMcpHttp(toolkit(), { maxBodyBytes: 2048 });
  try {
    const noSession = await post(h.url, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.equal(noSession.status, 400);
    const unknown = await post(h.url, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "nope" });
    assert.equal(unknown.status, 404);
    assert.equal((await post(h.url.replace("/mcp", "/other"), init)).status, 404);
    const big = await post(h.url, { ...init, pad: "x".repeat(5000) });
    assert.equal(big.status, 413);
    const bad = await fetch(h.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{not json" });
    assert.equal(bad.status, 400);
  } finally { await h.close(); }
});

test("session cap is enforced and sessions are isolated per client", async () => {
  const h = await serveMcpHttp(toolkit(), { maxSessions: 1 });
  try {
    assert.equal((await post(h.url, init)).status, 200);
    assert.equal((await post(h.url, init)).status, 503);
  } finally { await h.close(); }
});
