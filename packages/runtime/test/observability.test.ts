import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@agentic-tools/core";
import { createToolkit } from "../src/toolkit.js";
import { classifyInvocation } from "../src/invoke.js";
import { MetricsCollector } from "../src/metrics.js";

const echo = defineTool({ name: "observe.echo", description: "Echo text", sideEffect: "read",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: async (input: { text: string }) => input.text });
function setup(t: { after(fn: () => void): void }, tools: ToolDefinition[] = [echo as ToolDefinition]) {
  const workspace = mkdtempSync(join(tmpdir(), "at-observe-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return createToolkit({ workspace, tools, policy: { secrets: ["observability-test-canary"] } });
}

test("every runtime exit has one correlated trace, metric and audit pair", async (t) => {
  const toolkit = setup(t);
  const results = [
    await toolkit.invoke("observe.echo", { text: "yes" }),
    await toolkit.invoke("observe.echo", {}),
    await toolkit.invoke("unknown", {}),
    await toolkit.select({ name: [] }).invoke("observe.echo", {})
  ];
  assert.equal(toolkit.traceRecords().length, results.length);
  assert.equal(toolkit.metrics().reduce((sum, row) => sum + row.count, 0), results.length);
  for (const result of results) {
    assert.ok(result.timing);
    const events = toolkit.auditEvents().filter((event) => event.traceId === result.traceId);
    assert.equal(events.filter((event) => event.type === "invocation.start").length, 1);
    assert.equal(events.filter((event) => event.type === "invocation.end").length, 1);
    assert.equal(toolkit.traceRecords().filter((trace) => trace.traceId === result.traceId).length, 1);
  }
  assert.equal(toolkit.traceRecords()[1]?.policyDecision, "not_evaluated");
});

test("early denial messages and traces are redacted; unknown names do not become metric labels", async (t) => {
  const toolkit = setup(t);
  for (let i = 0; i < 30; i++) await toolkit.invoke(`observability-test-canary-${i}`, {});
  assert.ok(!JSON.stringify([toolkit.auditEvents(), toolkit.traceRecords()]).includes("observability-test-canary"));
  assert.equal(toolkit.metrics().length, 1);
  assert.equal(toolkit.metrics()[0]?.tool, "[unknown]");
  assert.equal(toolkit.metrics()[0]?.count, 30);
  const copy = toolkit.metrics();
  copy[0]!.count = 0;
  assert.equal(toolkit.metrics()[0]?.count, 30);
});

test("metrics have a fixed retention cap", () => {
  const metrics = new MetricsCollector(2);
  for (const tool of ["a", "b", "c"]) metrics.record({ tool, status: "success", policyDecision: "allow", durationMs: 1 });
  assert.equal(metrics.snapshot().length, 2);
});

test("malformed classifier falls back to all static bounds, including capabilities", () => {
  const tool = { ...echo, sideEffect: "destructive", risk: "high", capabilities: ["private.read"],
    classify: () => ({ sideEffect: "read", risk: "low", capabilities: null }) } as unknown as ToolDefinition;
  assert.deepEqual(classifyInvocation(tool, {}), { sideEffect: "destructive", risk: "high", capabilities: [{ name: "private.read" }] });
});

test("pre-cancelled calls never execute and produce a cancelled trace", async (t) => {
  let executed = false;
  const tool = defineTool({ ...echo, execute: async () => { executed = true; } });
  const toolkit = setup(t, [tool as ToolDefinition]);
  const controller = new AbortController();
  controller.abort("not model-visible");
  const result = await toolkit.invoke(tool.name, { text: "x" }, { signal: controller.signal });
  assert.equal(result.status === "error" && result.error.code, "cancelled");
  assert.equal(executed, false);
  assert.equal(toolkit.traceRecords()[0]?.errorCode, "cancelled");
});

test("caller cancellation propagates and returns even if a tool ignores it", async (t) => {
  const controller = new AbortController();
  let observed = false;
  const tool = defineTool({ ...echo, execute: async (_input, context) => {
    context.signal.addEventListener("abort", () => { observed = true; });
    controller.abort();
    return new Promise<never>(() => {});
  } });
  const toolkit = setup(t, [tool as ToolDefinition]);
  const result = await toolkit.invoke(tool.name, { text: "x" }, { signal: controller.signal });
  assert.equal(result.status === "error" && result.error.code, "cancelled");
  assert.equal(observed, true);
});

test("cancelled approval is removed; late allow cannot execute or become remembered", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-approval-cancel-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const controller = new AbortController();
  let called = 0;
  let release!: (value: { outcome: "allow"; scope: "remember" }) => void;
  const tool = defineTool({ ...echo, execute: async () => { called++; return "unsafe"; } });
  const toolkit = createToolkit({ workspace, tools: [tool as ToolDefinition],
    policy: { approvals: { [tool.name]: "ask" }, allowRememberedApprovals: true },
    approvers: [{ name: "deferred", async approve() {
      controller.abort();
      return new Promise((resolve) => { release = resolve; });
    } }] });
  const result = await toolkit.invoke(tool.name, { text: "x" }, { signal: controller.signal });
  assert.equal(result.status === "error" && result.error.code, "cancelled");
  assert.equal(toolkit.listPendingApprovals().length, 0);
  release({ outcome: "allow", scope: "remember" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, 0);
  toolkit._state.approvers = [];
  const again = await toolkit.invoke(tool.name, { text: "x" });
  assert.equal(again.status === "error" && again.error.code, "approval_required");
});

test("malformed schemas fail during registration before any invocation", (t) => {
  assert.throws(() => setup(t, [{ ...echo, inputSchema: { type: "not-a-type" } } as ToolDefinition]), /schema/);
});
