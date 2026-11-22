import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createToolkit } from "@agentic-tools/runtime";
import { allowAllApprover } from "@agentic-tools/security";
import { launchMcpServer } from "../src/index.js";

// Compiled tests run from dist/test; the fixture stays in the source test dir.
const fixture = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixture-server.mjs");
const ws = () => mkdtempSync(join(tmpdir(), "at-mcplaunch-"));

test("spawns a real stdio MCP server and registers its tools as untrusted", async () => {
  const launched = await launchMcpServer(
    { transport: "stdio", command: process.execPath, args: [fixture] },
    { prefix: "fx" }
  );
  try {
    // The fixture server hides its approval-gated "danger" tool (no elicitation,
    // no out-of-band approver), so only "echo" is exposed to register.
    assert.deepEqual(launched.tools.map((t) => t.name).sort(), ["fx.echo"]);
    assert.deepEqual(launched.skipped, []);
    assert.ok(launched.tools.every((t) => t.sideEffect === "external" && t.risk === "high"));

    const toolkit = createToolkit({
      workspace: ws(),
      tools: launched.tools,
      approvers: [allowAllApprover()],
      policy: { capabilities: { "mcp.call": true } }
    } as never);
    const ok = await toolkit.invoke("fx.echo", { text: "hi" });
    assert.equal(ok.status, "success");
    if (ok.status === "success") {
      const out = ok.output as { text?: string; untrusted?: boolean };
      assert.equal(out.untrusted, true);
      assert.match(out.text ?? "", /echo:hi/);
    }
  } finally {
    await launched.close();
  }
});

test("policy still gates a spawned server's tools (fail closed without mcp.call)", async () => {
  const launched = await launchMcpServer(
    { transport: "stdio", command: process.execPath, args: [fixture] },
    { prefix: "fx" }
  );
  try {
    const toolkit = createToolkit({ workspace: ws(), tools: launched.tools } as never);
    const r = await toolkit.invoke("fx.echo", { text: "x" });
    assert.equal(r.status === "error" && r.error.code, "permission_denied");
  } finally {
    await launched.close();
  }
});

test("connects over Streamable HTTP with a bearer token and honors the server session", async () => {
  const { serveMcpHttp } = await import("@agentic-tools/adapter-mcp");
  const { defineTool } = await import("@agentic-tools/core");
  const { createToolkit: hostToolkit } = await import("@agentic-tools/runtime");
  const readTool = defineTool({
    name: "host_read",
    description: "reads",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    sideEffect: "read",
    execute: async ({ q }: { q?: string }) => `read:${q ?? ""}`
  });
  const upstream = hostToolkit({ workspace: ws(), tools: [readTool as never] } as never);
  const token = "0123456789abcdef-token";
  const server = await serveMcpHttp(upstream, { authToken: token });
  try {
    await assert.rejects(
      launchMcpServer({ transport: "http", url: server.url }, { prefix: "up" })
    );
    const launched = await launchMcpServer(
      { transport: "http", url: server.url, authToken: token },
      { prefix: "up" }
    );
    try {
      assert.deepEqual(launched.tools.map((t) => t.name), ["up.host_read"]);
      const toolkit = createToolkit({
        workspace: ws(),
        tools: launched.tools,
        approvers: [allowAllApprover()],
        policy: { capabilities: { "mcp.call": true } }
      } as never);
      const r = await toolkit.invoke("up.host_read", { q: "z" });
      assert.equal(r.status, "success");
    } finally {
      await launched.close();
    }
  } finally {
    await server.close();
  }
});

test("rejects non-http URLs and unknown transports", async () => {
  await assert.rejects(
    launchMcpServer({ transport: "http", url: "file:///etc/passwd" }, { prefix: "x" })
  );
  await assert.rejects(
    launchMcpServer({ transport: "carrier-pigeon" } as never, { prefix: "x" })
  );
});

test("dotted remote names (our own server's names) register and stay policy-gated", async () => {
  const { serveMcpHttp } = await import("@agentic-tools/adapter-mcp");
  const { defineTool } = await import("@agentic-tools/core");
  const { createToolkit: hostToolkit } = await import("@agentic-tools/runtime");
  const readTool = defineTool({
    name: "host.read",
    description: "reads",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    sideEffect: "read",
    execute: async ({ q }: { q?: string }) => `read:${q ?? ""}`
  });
  const upstream = hostToolkit({ workspace: ws(), tools: [readTool as never] } as never);
  const server = await serveMcpHttp(upstream);
  try {
    const launched = await launchMcpServer({ transport: "http", url: server.url }, { prefix: "up" });
    try {
      assert.deepEqual(launched.tools.map((t) => t.name), ["up.host.read"]);
      assert.deepEqual(launched.skipped, []);
      const toolkit = createToolkit({
        workspace: ws(),
        tools: launched.tools,
        approvers: [allowAllApprover()],
        policy: { capabilities: { "mcp.call": true } }
      } as never);
      const r = await toolkit.invoke("up.host.read", { q: "z" });
      assert.equal(r.status, "success");
      if (r.status === "success") assert.equal((r.output as { untrusted?: boolean }).untrusted, true);
    } finally {
      await launched.close();
    }
  } finally {
    await server.close();
  }
});
