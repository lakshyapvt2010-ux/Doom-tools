import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@agentic-tools/core";
import { callbackApprover } from "@agentic-tools/security";
import { createToolkit, type Toolkit } from "../src/toolkit.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "at-runtime-"));
}

const echoTool = defineTool({
  name: "test.echo",
  description: "Echo input",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false
  },
  sideEffect: "read",
  execute: async ({ text }: { text: string }) => ({ text })
});

const writeTool = defineTool({
  name: "test.write",
  description: "Write a file in workspace",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false
  },
  sideEffect: "write",
  capabilities: ["filesystem.write"],
  risk: "medium",
  tags: ["fs"],
  execute: async () => "ok"
});

function makeToolkit(extra: Parameters<typeof createToolkit>[0] extends infer T ? Partial<T> : never = {}): Toolkit {
  const workspace = tmp();
  return createToolkit({
    workspace,
    tools: [echoTool as never, writeTool as never],
    ...(extra as object)
  } as Parameters<typeof createToolkit>[0]);
}

test("invoke wraps plain returns and reports timing", async () => {
  const tk = makeToolkit();
  const res = await tk.invoke<{ text: string }>("test.echo", { text: "hi" });
  assert.equal(res.status, "success");
  if (res.status === "success") assert.deepEqual(res.output, { text: "hi" });
  assert.ok(res.traceId);
  assert.ok(res.timing && res.timing.durationMs >= 0);
});

test("invalid input is rejected with a stable validation error (FR-002)", async () => {
  const tk = makeToolkit();
  const res = await tk.invoke("test.echo", { nope: 1 });
  assert.equal(res.status, "error");
  if (res.status === "error") {
    assert.equal(res.error.code, "validation");
    assert.ok(JSON.stringify(res.error.details).includes("text"));
  }
});

test("unknown and non-selected tools are permission_denied (FR-019)", async () => {
  const tk = makeToolkit();
  const unknown = await tk.invoke("does.not.exist", {});
  assert.equal(unknown.status, "error");
  if (unknown.status === "error") assert.equal(unknown.error.code, "permission_denied");

  const narrowed = tk.select({ name: "test.echo" });
  const dropped = await narrowed.invoke("test.write", { path: "x" });
  assert.equal(dropped.status, "error");
  if (dropped.status === "error") assert.equal(dropped.error.code, "permission_denied");
});

test("select narrows by side effect and tag, never widens", async () => {
  const tk = makeToolkit();
  const readOnly = tk.select({ sideEffect: ["read"] });
  assert.deepEqual(readOnly.listTools().map((t) => t.name), ["test.echo"]);
  const byTag = tk.select({ tag: "fs" });
  assert.deepEqual(byTag.listTools().map((t) => t.name), ["test.write"]);
  // narrowing again from an empty match stays empty
  const empty = byTag.select({ name: "test.echo" });
  assert.deepEqual(empty.listTools(), []);
});

test("classification is clamped to declared bounds (FR-020)", async () => {
  const widening = defineTool({
    name: "test.widening",
    description: "tries to widen via classify",
    inputSchema: { type: "object" },
    sideEffect: "read",
    capabilities: ["filesystem.read"],
    risk: "low",
    classify: () => ({
      sideEffect: "destructive" as const,
      risk: "high" as const,
      capabilities: [{ name: "cloud.deploy" }]
    }),
    execute: async () => "ok"
  });
  const tk = createToolkit({ workspace: tmp(), tools: [widening as never] });
  const res = await tk.invoke("test.widening", {});
  // destructive would require approval; clamped to read/low, so it runs.
  assert.equal(res.status, "success");

  const throwing = defineTool({
    name: "test.throwing",
    description: "classify throws; falls back to static bounds",
    inputSchema: { type: "object" },
    sideEffect: "destructive",
    risk: "high",
    capabilities: [],
    classify: () => {
      throw new Error("ambiguous");
    },
    execute: async () => "ok"
  });
  const tk2 = createToolkit({ workspace: tmp(), tools: [throwing as never] });
  const res2 = await tk2.invoke("test.throwing", {});
  // static bounds are destructive => approval required, no approver.
  assert.equal(res2.status, "error");
  if (res2.status === "error") assert.equal(res2.error.code, "approval_required");
});

test("policy denial on capability escape", async () => {
  const escape = defineTool({
    name: "test.escape",
    description: "requests a path outside the workspace",
    inputSchema: { type: "object" },
    sideEffect: "write",
    capabilities: ["filesystem.write"],
    risk: "medium",
    classify: () => ({
      sideEffect: "write" as const,
      risk: "medium" as const,
      capabilities: [{ name: "filesystem.write", path: "/etc/passwd" }]
    }),
    execute: async () => "ok"
  });
  const tk = createToolkit({ workspace: tmp(), tools: [escape as never] });
  const res = await tk.invoke("test.escape", {});
  assert.equal(res.status, "error");
  if (res.status === "error") assert.equal(res.error.code, "permission_denied");
});

test("approval flow: no approver fails with approval_required, never auto-approved", async () => {
  const gated = defineTool({
    name: "test.danger",
    description: "destructive op",
    inputSchema: { type: "object" },
    sideEffect: "destructive",
    risk: "high",
    capabilities: [],
    execute: async () => "ran"
  });
  const tk = createToolkit({ workspace: tmp(), tools: [gated as never] });
  const res = await tk.invoke("test.danger", {});
  assert.equal(res.status, "error");
  if (res.status === "error") {
    assert.equal(res.error.code, "approval_required");
    assert.ok(res.error.details?.approvalRequestId);
  }
});

test("approval flow: callback approver allows and denies", async () => {
  let ran = 0;
  const gated = defineTool({
    name: "test.danger2",
    description: "destructive op",
    inputSchema: { type: "object", properties: { x: { type: "number" } } },
    sideEffect: "destructive",
    risk: "high",
    capabilities: [],
    execute: async () => {
      ran++;
      return "ran";
    }
  });
  const allow = createToolkit({
    workspace: tmp(),
    tools: [gated as never],
    approvers: [callbackApprover(() => ({ outcome: "allow" as const }))]
  });
  const ok = await allow.invoke("test.danger2", { x: 1 });
  assert.equal(ok.status, "success");
  assert.equal(ran, 1);

  const deny = createToolkit({
    workspace: tmp(),
    tools: [gated as never],
    approvers: [callbackApprover(() => ({ outcome: "deny" as const, reason: "no" }))]
  });
  const no = await deny.invoke("test.danger2", { x: 2 });
  assert.equal(no.status, "error");
  if (no.status === "error") assert.equal(no.error.code, "permission_denied");
  assert.equal(ran, 1); // denied call never executed
});

test("timeout produces a stable timeout error (FR-008)", async () => {
  const slow = defineTool({
    name: "test.slow",
    description: "sleeps",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: async (_input: unknown, ctx) => {
      await new Promise((r) => setTimeout(r, 5000));
      void ctx;
      return "done";
    }
  });
  const tk = createToolkit({
    workspace: tmp(),
    tools: [slow as never],
    policy: { timeouts: { defaultMs: 100 } }
  });
  const res = await tk.invoke("test.slow", {});
  assert.equal(res.status, "error");
  if (res.status === "error") assert.equal(res.error.code, "timeout");
});

test("output budgets truncate deterministically with explicit markers (FR-022)", async () => {
  const big = defineTool({
    name: "test.big",
    description: "big string output",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: async () => "x".repeat(10000)
  });
  const tk = createToolkit({
    workspace: tmp(),
    tools: [big as never],
    policy: { budgets: { maxOutputBytes: 1000 } }
  });
  const res = await tk.invoke<string>("test.big", {});
  assert.equal(res.status, "success");
  if (res.status === "success") {
    assert.equal((res.output as string).length, 998);
    assert.equal(res.truncation?.truncated, true);
    assert.equal(res.truncation?.unit, "bytes");
    assert.equal(res.truncation?.omitted, 9002);
    assert.ok(res.truncation?.continuation);
  }
});

test("registered secrets are redacted from outputs and errors", async () => {
  const leaky = defineTool({
    name: "test.leaky",
    description: "echoes a secret",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: async () => "token=canary-secret-value-123"
  });
  const failing = defineTool({
    name: "test.leakyerr",
    description: "throws a secret",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: async () => {
      throw new Error("failed with canary-secret-value-123");
    }
  });
  const tk = createToolkit({
    workspace: tmp(),
    tools: [leaky as never, failing as never],
    policy: { secrets: ["canary-secret-value-123"] }
  });
  const res = await tk.invoke<string>("test.leaky", {});
  assert.ok(!JSON.stringify(res).includes("canary-secret-value-123"));
  const err = await tk.invoke("test.leakyerr", {});
  assert.ok(!JSON.stringify(err).includes("canary-secret-value-123"));
});

test("services are scoped by declared capabilities and policy (PRD 8.3)", async () => {
  const dbService = { users: { search: async ({ query }: { query: string }) => [`u:${query}`] } };
  const userSearch = defineTool({
    name: "test.search_users",
    description: "search users",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    sideEffect: "read",
    capabilities: ["database.read"],
    execute: async ({ query }: { query: string }, ctx) => {
      const db = ctx.services.database as typeof dbService;
      return db.users.search({ query });
    }
  });
  const nosecap = defineTool({
    name: "test.nocap",
    description: "no database capability declared",
    inputSchema: { type: "object" },
    sideEffect: "read",
    execute: async (_input: unknown, ctx) => {
      // Access must throw permission_denied.
      return (ctx.services as Record<string, unknown>).database;
    }
  });
  const tk = createToolkit({
    workspace: tmp(),
    tools: [userSearch as never, nosecap as never],
    services: { database: dbService },
    policy: { capabilities: { "database.read": true } }
  });
  const ok = await tk.invoke<string[]>("test.search_users", { query: "ada" });
  assert.equal(ok.status, "success");
  if (ok.status === "success") assert.deepEqual(ok.output, ["u:ada"]);

  const denied = await tk.invoke("test.nocap", {});
  assert.equal(denied.status, "error");
  // The service-scope proxy throws ToolError(permission_denied), which
  // passes through the error model exactly (intentional disclosure path).
  if (denied.status === "error") assert.equal(denied.error.code, "permission_denied");
});

test("audit events correlate invocation, policy and outcome (FR-010)", async () => {
  const tk = makeToolkit();
  const res = await tk.invoke("test.echo", { text: "hi" });
  const events = tk.auditEvents().filter((e) => e.traceId === res.traceId);
  const types = events.map((e) => e.type);
  assert.ok(types.includes("invocation.start"));
  assert.ok(types.includes("policy.decision"));
  assert.ok(types.includes("invocation.end"));
  const traces = tk.traceRecords().filter((t) => t.traceId === res.traceId);
  assert.equal(traces.length, 1);
  assert.equal(traces[0]?.status, "success");
});

test("footprint reports per-tool token estimates (PRD 8.6)", () => {
  const tk = makeToolkit();
  const footprint = tk.describeFootprint();
  assert.equal(footprint.perTool.length, 2);
  assert.ok(footprint.totalTokens > 0);
});

test("toolkit fails closed when a policy-required capability is unavailable", async () => {
  const workspace = tmp();
  mkdirSync(join(workspace, "sub"), { recursive: true });
  writeFileSync(join(workspace, "f.txt"), "hi");
  // unreachable backend requested
  assert.throws(() =>
    createToolkit({
      workspace,
      tools: [],
      runtime: { backend: "container" as never }
    })
  );
});

test("an invalid classify shape fails closed to the static bounds (FR-020)", async () => {
  // A buggy or hostile classify hook returning out-of-enum values must
  // never sail past policy: the invocation falls back to the declared
  // destructive/high static bounds, which default to requiring approval.
  const weird = defineTool({
    name: "test.weird_classify",
    description: "classify returns garbage enums",
    inputSchema: { type: "object" },
    sideEffect: "destructive",
    risk: "high",
    capabilities: [],
    classify: () => ({ sideEffect: "bogus-value", risk: "also-bogus", capabilities: [] }) as never,
    execute: async () => "EXECUTED"
  });
  const tk = createToolkit({ workspace: tmp(), tools: [weird as never] });
  const res = await tk.invoke("test.weird_classify", {});
  assert.equal(res.status, "error");
  if (res.status === "error") assert.equal(res.error.code, "approval_required");
});

test("a non-cooperative tool cannot hang the runtime past its deadline (FR-008)", async () => {
  // The tool ignores ctx.signal entirely and never settles. The runtime
  // must still return a timeout error promptly (it stops waiting; it
  // cannot forcibly stop the host-side work).
  const sleeper = defineTool({
    name: "test.sleeper",
    description: "never resolves",
    inputSchema: { type: "object" },
    sideEffect: "read",
    risk: "low",
    capabilities: [],
    execute: () => new Promise(() => {})
  });
  const tk = createToolkit({
    workspace: tmp(),
    tools: [sleeper as never],
    policy: { timeouts: { defaultMs: 300 } }
  });
  const started = Date.now();
  const res = await tk.invoke("test.sleeper", {});
  const elapsed = Date.now() - started;
  assert.equal(res.status, "error");
  if (res.status === "error") {
    assert.equal(res.error.code, "timeout");
    assert.match(res.error.message, /stopped waiting/);
  }
  assert.ok(elapsed < 5000, `took ${elapsed}ms`);
});
