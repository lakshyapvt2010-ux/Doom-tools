import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bash } from "../src/index.js";
import type { ToolContext, ToolResult } from "@agentic-tools/core";

function ctx(root: string): ToolContext {
  return {
    traceId: "t",
    signal: new AbortController().signal,
    workspace: root,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    services: {}
  } as ToolContext;
}

async function run<T>(tool: ToolResult extends never ? never : ReturnType<typeof bash>[0], input: unknown, c: ToolContext): Promise<ToolResult<T>> {
  return tool.execute(input, c) as Promise<ToolResult<T>>;
}

test("mode is a required explicit opt-in", () => {
  assert.throws(() => bash({ mode: "sandboxed" as never }));
  assert.equal(bash({ mode: "trusted-host" }).length, 1);
});

test("unknown commands classify destructive/high; named commands narrow", () => {
  const [tool] = bash({
    mode: "trusted-host",
    namedCommands: [{ name: "ls", command: "ls", sideEffect: "read", risk: "low" }]
  });
  assert.ok(tool);
  const unknown = tool.classify?.({ command: "rm -rf /tmp/x" });
  assert.equal(unknown?.sideEffect, "destructive");
  assert.equal(unknown?.risk, "high");
  const named = tool.classify?.({ command: "ls -la" });
  assert.equal(named?.sideEffect, "read");
  assert.equal(named?.risk, "low");
});

test("compound or expanding commands never inherit a named classification", () => {
  const [tool] = bash({
    mode: "trusted-host",
    namedCommands: [{ name: "ls", command: "ls", sideEffect: "read", risk: "low" }]
  });
  assert.ok(tool);
  // Each of these executes MORE than `ls` (or hides intent); all must
  // fail closed to destructive/high so policy approval-gates them.
  const unsafe = [
    "ls /tmp; touch /tmp/at-pwned",
    "ls /tmp && touch /tmp/at-pwned",
    "ls || touch /tmp/at-pwned",
    "ls | cat",
    "ls > /tmp/at-pwned",
    "ls >> /tmp/at-pwned 2>&1",
    "ls $(touch /tmp/at-pwned)",
    "ls `touch /tmp/at-pwned`",
    'ls "$(touch /tmp/at-pwned)"',
    "ls $HOME",
    "ls ${HOME}",
    "FOO=bar ls",
    "/bin/ls",
    "./ls",
    "lss",
    "ls\nls"
  ];
  for (const command of unsafe) {
    const classified: { sideEffect?: unknown; risk?: unknown } | undefined = tool.classify?.({ command });
    assert.equal(classified?.sideEffect, "destructive", command);
    assert.equal(classified?.risk, "high", command);
  }
  // Plain argv of the exact executable still narrows as configured.
  const safe = ["ls", "ls -la /tmp", "ls 'two words'", 'ls "two words"', "ls *.ts"];
  for (const command of safe) {
    const classified: { sideEffect?: unknown; risk?: unknown } | undefined = tool.classify?.({ command });
    assert.equal(classified?.sideEffect, "read", command);
    assert.equal(classified?.risk, "low", command);
  }
});

test("the child gets a minimal allowlisted environment, not host secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "at-bash-"));
  process.env.AT_UNDECLARED_TEST_SECRET = "supersecret-env-value-12345";
  try {
    const [tool] = bash({ mode: "trusted-host" });
    assert.ok(tool);
    const res = await run<{ stdout: string }>(tool, { command: "printenv" }, ctx(root));
    assert.equal(res.status, "success");
    if (res.status === "success") {
      assert.ok(!res.output.stdout.includes("AT_UNDECLARED_TEST_SECRET"));
      assert.ok(!res.output.stdout.includes("supersecret-env-value-12345"));
      // basic variables a shell needs are still present
      assert.match(res.output.stdout, /PATH=/);
      assert.match(res.output.stdout, /HOME=/);
    }
    // Explicit opt-in passes the variable through.
    const [widened] = bash({ mode: "trusted-host", envAllowlist: ["AT_UNDECLARED_TEST_SECRET"] });
    assert.ok(widened);
    const res2 = await run<{ stdout: string }>(
      widened,
      { command: "printenv AT_UNDECLARED_TEST_SECRET" },
      ctx(root)
    );
    assert.equal(res2.status, "success");
    if (res2.status === "success") {
      assert.ok(res2.output.stdout.includes("supersecret-env-value-12345"));
    }
  } finally {
    delete process.env.AT_UNDECLARED_TEST_SECRET;
  }
});

test("executes and captures stdout/stderr/exit code", async () => {
  const root = mkdtempSync(join(tmpdir(), "at-bash-"));
  const [tool] = bash({ mode: "trusted-host" });
  assert.ok(tool);
  const res = await run<{ exitCode: number; stdout: string }>(tool, { command: "echo hello" }, ctx(root));
  assert.equal(res.status, "success");
  if (res.status === "success") {
    assert.equal(res.output.exitCode, 0);
    assert.equal(res.output.stdout.trim(), "hello");
  }
  const fail = await run<{ exitCode: number; stderr: string }>(tool, { command: "echo oops >&2; exit 3" }, ctx(root));
  if (fail.status === "success") {
    assert.equal(fail.output.exitCode, 3);
    assert.match(fail.output.stderr, /oops/);
  }
});

test("cwd is confined to the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "at-bash-"));
  const [tool] = bash({ mode: "trusted-host" });
  assert.ok(tool);
  const res = await run(tool, { command: "pwd", cwd: "/tmp" }, ctx(root));
  assert.equal(res.status, "error");
  if (res.status === "error") assert.equal(res.error.code, "permission_denied");
});

test("timeout kills the process with a stable error", async () => {
  const root = mkdtempSync(join(tmpdir(), "at-bash-"));
  const [tool] = bash({ mode: "trusted-host", maxTimeoutMs: 5000 });
  assert.ok(tool);
  const started = Date.now();
  const res = await run(tool, { command: "sleep 30", timeoutMs: 300 }, ctx(root));
  assert.ok(Date.now() - started < 5000);
  assert.equal(res.status, "error");
  if (res.status === "error") assert.equal(res.error.code, "timeout");
});

test("oversized output is capped with an explicit truncation marker", async () => {
  const root = mkdtempSync(join(tmpdir(), "at-bash-"));
  writeFileSync(join(root, "big.txt"), "y".repeat(200_000));
  const [tool] = bash({ mode: "trusted-host", maxOutputBytes: 1000 });
  assert.ok(tool);
  const res = await run<{ stdout: string }>(tool, { command: "cat big.txt" }, ctx(root));
  assert.equal(res.status, "success");
  if (res.status === "success") assert.ok(res.output.stdout.length <= 1000);
  assert.equal(res.truncation?.truncated, true);
  assert.ok((res.truncation?.omitted ?? 0) > 0);
});
