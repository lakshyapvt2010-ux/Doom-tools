import assert from "node:assert/strict";
import { test } from "node:test";
import { createRedactor, REDACTED } from "../src/redact.js";
import { ApprovalManager, approvalInputHash } from "../src/approvals.js";
import { callbackApprover } from "../src/approvers.js";

const invocation = { sideEffect: "write" as const, risk: "low" as const, capabilities: [] };

test("registered secrets are redacted from text", () => {
  const r = createRedactor({ secrets: ["hunter2-super-secret"] });
  assert.equal(
    r.redactText("the password is hunter2-super-secret ok"),
    `the password is ${REDACTED} ok`
  );
});

test("common token shapes are redacted", () => {
  const r = createRedactor();
  assert.equal(r.redactText("key: AKIA1234567890ABCDEF"), `key: ${REDACTED}`);
  assert.match(r.redactText("ghp_abcdefghijklmnopqrstuvwxyz123456"), new RegExp(REDACTED));
  assert.match(r.redactText("Authorization: Bearer abcdefghijklmnop"), new RegExp(REDACTED));
  const kv = r.redactText('api_key = "abcdef123456789"');
  assert.match(kv, /api_key\s*=\s*"/);
  assert.match(kv, new RegExp(REDACTED));
});

test("redactValue walks nested structures", () => {
  const r = createRedactor({ secrets: ["s3cr3t"] });
  const out = r.redactValue({ a: ["s3cr3t", { b: "xx s3cr3t yy" }], c: 1 });
  assert.deepEqual(out, { a: [REDACTED, { b: `xx ${REDACTED} yy` }], c: 1 });
});

test("approval decisions bind to the exact classified input", () => {
  const h1 = approvalInputHash({ name: "t", version: "1" }, { command: "ls" }, invocation);
  const h2 = approvalInputHash({ name: "t", version: "1" }, { command: "ls -la" }, invocation);
  assert.notEqual(h1, h2);
  const h3 = approvalInputHash({ name: "t", version: "1" }, { command: "ls" }, invocation);
  assert.equal(h1, h3);
});

test("manager routes to the first approver that can decide", async () => {
  const manager = new ApprovalManager({ redactor: createRedactor() });
  const request = manager.createRequest(
    { name: "t", version: "1" },
    { command: "rm -rf /" },
    { sideEffect: "destructive", risk: "high", capabilities: [] },
    'tool "bash.execute"',
    "trace-1"
  );
  const cannot = callbackApprover(() => null, "cannot");
  const can = callbackApprover(() => ({ outcome: "allow" as const }), "can");
  const decision = await manager.requestApproval(request, [cannot, can]);
  assert.equal(decision?.outcome, "allow");
});

test("no approver available resolves null (never auto-approved)", async () => {
  const manager = new ApprovalManager({ redactor: createRedactor() });
  const request = manager.createRequest(
    { name: "t", version: "1" },
    {},
    invocation,
    "rule",
    "trace-2"
  );
  const decision = await manager.requestApproval(request, []);
  assert.equal(decision, null);
});

test("remembered decisions only honored for ask rules with policy opt-in", async () => {
  const manager = new ApprovalManager({
    redactor: createRedactor(),
    allowRememberedApprovals: true
  });
  const request = manager.createRequest(
    { name: "t", version: "1" },
    { x: 1 },
    invocation,
    "rule",
    "trace-3"
  );
  const rememberer = callbackApprover(() => ({ outcome: "allow" as const, scope: "remember" as const }));
  await manager.requestApproval(request, [rememberer]);
  assert.equal(manager.rememberedDecision(request, "ask")?.outcome, "allow");
  assert.equal(manager.rememberedDecision(request, "always"), null);

  const strict = new ApprovalManager({ redactor: createRedactor() });
  const req2 = strict.createRequest({ name: "t", version: "1" }, { x: 1 }, invocation, "r", "t");
  await strict.requestApproval(req2, [rememberer]);
  assert.equal(strict.rememberedDecision(req2, "ask"), null);
});

test("request preview is redacted and capped", () => {
  const manager = new ApprovalManager({
    redactor: createRedactor({ secrets: ["topsecretvalue"] })
  });
  const request = manager.createRequest(
    { name: "t", version: "1" },
    { token: "topsecretvalue", big: "x".repeat(5000) },
    invocation,
    "rule",
    "trace-4"
  );
  assert.ok(!request.inputPreview.includes("topsecretvalue"));
  assert.ok(request.inputPreview.length <= 603 + 3);
});

test("remembered decisions expire after their TTL", async () => {
  const manager = new ApprovalManager({
    redactor: createRedactor(),
    allowRememberedApprovals: true,
    rememberTtlMs: 50
  });
  const request = manager.createRequest(
    { name: "t", version: "1" },
    { x: 1 },
    invocation,
    "rule",
    "trace-ttl"
  );
  const rememberer = callbackApprover(() => ({ outcome: "allow" as const, scope: "remember" as const }));
  await manager.requestApproval(request, [rememberer]);
  assert.equal(manager.rememberedDecision(request, "ask")?.outcome, "allow");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(manager.rememberedDecision(request, "ask"), null);
});

test("remembered store is bounded and revocable", async () => {
  const manager = new ApprovalManager({
    redactor: createRedactor(),
    allowRememberedApprovals: true,
    rememberMaxEntries: 2
  });
  const rememberer = callbackApprover(() => ({ outcome: "allow" as const, scope: "remember" as const }));
  const requests = [1, 2, 3].map((x) =>
    manager.createRequest({ name: "t", version: "1" }, { x }, invocation, "rule", `trace-${x}`)
  );
  for (const request of requests) await manager.requestApproval(request, [rememberer]);
  // capacity 2: the oldest entry was evicted
  assert.equal(manager.rememberedDecision(requests[0]!, "ask"), null);
  assert.equal(manager.rememberedDecision(requests[2]!, "ask")?.outcome, "allow");
  manager.clearRemembered();
  assert.equal(manager.rememberedDecision(requests[2]!, "ask"), null);
});

test("file-queue decisions require the exact inputHash binding (fail closed)", async () => {
  const { fileQueueApprover, writeQueuedDecision } = await import("../src/approvers.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "at-queue-"));
  const manager = new ApprovalManager({ redactor: createRedactor(), expiryMs: 3000 });
  const request = manager.createRequest(
    { name: "bash.execute", version: "0" },
    { command: "echo hi" },
    invocation,
    "rule",
    "trace-q"
  );
  const approver = fileQueueApprover({ dir, pollMs: 25 });
  const pending = manager.requestApproval(request, [approver]);
  await new Promise((r) => setTimeout(r, 100));
  // A hand-written decision WITHOUT the binding must not approve.
  writeQueuedDecision(dir, request.id, { outcome: "allow", decidedBy: "unbound" });
  const decision = await pending;
  assert.equal(decision?.outcome, "deny");
  assert.match(decision?.reason ?? "", /inputHash/);
});

test("file-queue decision with the correct binding is honored", async () => {
  const { fileQueueApprover, writeQueuedDecision } = await import("../src/approvers.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "at-queue-"));
  const manager = new ApprovalManager({ redactor: createRedactor(), expiryMs: 3000 });
  const request = manager.createRequest(
    { name: "bash.execute", version: "0" },
    { command: "echo hi" },
    invocation,
    "rule",
    "trace-q2"
  );
  const approver = fileQueueApprover({ dir, pollMs: 25 });
  const pending = manager.requestApproval(request, [approver]);
  await new Promise((r) => setTimeout(r, 100));
  writeQueuedDecision(dir, request.id, {
    outcome: "allow",
    decidedBy: "operator",
    inputHash: request.inputHash
  });
  const decision = await pending;
  assert.equal(decision?.outcome, "allow");
});
