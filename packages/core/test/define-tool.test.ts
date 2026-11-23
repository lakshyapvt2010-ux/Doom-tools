import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolError,
  defineTool,
  defineZodTool,
  type ToolContext
} from "../src/index.js";

const ctx: ToolContext = {
  traceId: "trace-test",
  signal: new AbortController().signal,
  logger: {
    debug() {},
    info() {},
    warn() {},
    error() {}
  },
  services: {},
  workspace: "/tmp/at-test-workspace"
};

test("wraps a plain return value in a success envelope", async () => {
  const tool = defineTool<{ query: string }, string[]>({
    name: "users.search",
    description: "Search users",
    version: "1.2.0",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["database.read"],
    execute: ({ query }) => [query]
  });

  const result = await tool.execute({ query: "ada" }, ctx);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.deepEqual(result.output, ["ada"]);
  }
  assert.deepEqual(result.tool, { name: "users.search", version: "1.2.0" });
  assert.equal(result.traceId, "trace-test");
});

test("passes an author-built envelope through, filling only a missing traceId", async () => {
  const tool = defineTool<{ q: string }, string[]>({
    name: "users.search.paged",
    description: "Search users with truncation marker",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: ({ q }, context) => ({
      status: "success",
      tool: { name: "users.search.paged", version: "0.0.0" },
      output: [q],
      warnings: ["result set truncated"],
      truncation: { truncated: true, unit: "entries", omitted: 137 },
      timing: { startedAt: 1, durationMs: 2 }
    })
  });

  const result = await tool.execute({ q: "ada" }, ctx);
  assert.equal(result.status, "success");
  assert.deepEqual(result.warnings, ["result set truncated"]);
  assert.deepEqual(result.truncation, {
    truncated: true,
    unit: "entries",
    omitted: 137
  });
  assert.equal(result.traceId, "trace-test");
});

test("ordinary business objects with status/output fields are NOT treated as envelopes", async () => {
  const orderStatus = defineTool<Record<string, never>, unknown>({
    name: "orders.status",
    description: "Return an order status object",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: () => ({ status: "success", output: "shipped" }) // no tool identity
  });
  const r1 = await orderStatus.execute({}, ctx);
  assert.equal(r1.status, "success");
  if (r1.status === "success") {
    assert.deepEqual(r1.output, { status: "success", output: "shipped" });
  }

  const ticket = defineTool<Record<string, never>, unknown>({
    name: "tickets.get",
    description: "Return a ticket",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: () => ({ status: "active", assignee: "ada" })
  });
  const r2 = await ticket.execute({}, ctx);
  assert.equal(r2.status, "success");
  if (r2.status === "success") {
    assert.deepEqual(r2.output, { status: "active", assignee: "ada" });
  }
});

test("malformed error-shaped outputs are NOT treated as envelopes", async () => {
  const badCode = defineTool<Record<string, never>, unknown>({
    name: "health.check",
    description: "Return a health payload",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: () => ({
      status: "error",
      tool: { name: "health.check", version: "1.0.0" },
      error: { code: "not_a_stable_code", message: "down" }
    })
  });
  const r1 = await badCode.execute({}, ctx);
  assert.equal(r1.status, "success");
  if (r1.status === "success") {
    assert.deepEqual(r1.output, {
      status: "error",
      tool: { name: "health.check", version: "1.0.0" },
      error: { code: "not_a_stable_code", message: "down" }
    });
  }

  const noIdentity = defineTool<Record<string, never>, unknown>({
    name: "health.check2",
    description: "Return another health payload",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: () => ({
      status: "error",
      error: { code: "validation", message: "down" } // missing tool identity
    })
  });
  const r2 = await noIdentity.execute({}, ctx);
  assert.equal(r2.status, "success");
  if (r2.status === "success") {
    assert.deepEqual(r2.output, {
      status: "error",
      error: { code: "validation", message: "down" }
    });
  }
});

test("ToolError is the intentional disclosure path: code and message pass through exactly", async () => {
  const tool = defineTool({
    name: "files.delete",
    description: "Delete a file",
    inputSchema: { type: "object" },
    sideEffect: "destructive",
    risk: "high",
    execute: () => {
      throw new ToolError("permission_denied", "outside workspace root");
    }
  });

  const result = await tool.execute({}, ctx);
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.error.code, "permission_denied");
    assert.equal(result.error.message, "outside workspace root");
  }
});

test("unknown throws become execution_error without exposing their message", async () => {
  // Unknown exception messages are not an intentional disclosure path.
  const tool = defineTool({
    name: "thing.run",
    description: "Run a thing",
    inputSchema: { type: "object" },
    sideEffect: "write",
    execute: () => {
      throw new Error("unregistered-private-canary /home/private/provider.env");
    }
  });

  const result = await tool.execute({}, ctx);
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.error.code, "execution_error");
    assert.equal(result.error.message, "Tool execution failed. Use an intentional ToolError for safe diagnostics.");
    assert.doesNotMatch(JSON.stringify(result), /unregistered-private-canary|provider\.env/);
    assert.ok(!("stack" in result.error));
    assert.ok(!("cause" in result.error));
  }
});

test("rejects invalid metadata at registration time", () => {
  assert.throws(() =>
    defineTool({
      name: "Bad Name!",
      description: "x",
      inputSchema: { type: "object" },
      sideEffect: "read",
      execute: () => null
    })
  );
  assert.throws(() =>
    defineTool({
      name: "ok.name",
      description: "  ",
      inputSchema: { type: "object" },
      sideEffect: "read",
      execute: () => null
    })
  );
});

test("keeps declared bounds and the classify hook on the definition", () => {
  const tool = defineTool<{ cmd: string }, string>({
    name: "process.execute",
    description: "Run a shell command",
    inputSchema: { type: "object", properties: { cmd: { type: "string" } } },
    sideEffect: "destructive",
    capabilities: ["process.execute"],
    risk: "high",
    // PRD 8.3: shell invocations classify destructive/high unless they
    // match an explicitly configured named command.
    classify: (input) => ({
      sideEffect: "destructive",
      risk: "high",
      capabilities: [{ name: "process.execute", command: input.cmd }]
    }),
    execute: ({ cmd }) => cmd
  });

  assert.equal(tool.sideEffect, "destructive");
  assert.equal(tool.risk, "high");
  const cls = tool.classify?.({ cmd: "rm -rf /" });
  assert.deepEqual(cls?.capabilities, [
    { name: "process.execute", command: "rm -rf /" }
  ]);
});

test("defineZodTool converts the schema and validates direct invocations", async () => {
  const fakeZod = {
    parse(input: unknown): { n: number } {
      if (
        typeof input === "object" &&
        input !== null &&
        typeof (input as { n?: unknown }).n === "number"
      ) {
        return { n: (input as { n: number }).n };
      }
      throw new Error("invalid");
    }
  };

  const tool = defineZodTool<{ n: number }, number>({
    name: "math.double",
    description: "Double a number",
    schema: fakeZod,
    toJSONSchema: () => ({
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"]
    }),
    sideEffect: "read",
    execute: ({ n }) => n * 2
  });

  assert.equal(tool.inputSchema.type, "object");
  const ok = await tool.execute({ n: 21 }, ctx);
  assert.equal(ok.status, "success");
  if (ok.status === "success") assert.equal(ok.output, 42);

  // Simulates unvalidated model input reaching a direct invocation.
  const bad = await tool.execute({ n: "x" } as unknown as { n: number }, ctx);
  assert.equal(bad.status, "error");
  if (bad.status === "error") assert.equal(bad.error.code, "validation");
});
