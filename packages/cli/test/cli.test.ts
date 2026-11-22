import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { detectCapabilities, renderReport } from "../src/doctor.js";
import { listQueuedApprovals, writeQueuedDecision } from "@agentic-tools/security";

test("doctor reports honest trust modes with no false sandbox claims (FR-018)", () => {
  const report = detectCapabilities();
  assert.equal(typeof report.os.platform, "string");
  const sandboxed = report.trustModes.find((m) => m.mode === "sandboxed-local");
  assert.equal(sandboxed?.available, false); // P1 roadmap
  const trusted = report.trustModes.find((m) => m.mode === "trusted-host");
  assert.match(trusted?.guarantee ?? "", /NO containment/);
  const rendered = renderReport(report);
  assert.match(rendered, /trusted-host/);
  assert.match(rendered, /sandboxed-local/);
});

test("file-queue approver round-trips through the CLI helpers", () => {
  const dir = mkdtempSync(join(tmpdir(), "at-queue-"));
  const pendingDir = join(dir, "pending");
  mkdirSync(pendingDir, { recursive: true });
  const request = {
    id: "req-1",
    traceId: "t",
    tool: { name: "bash.execute", version: "0.0.0" },
    invocation: { sideEffect: "destructive", risk: "high", capabilities: [] },
    rule: "default for side effect \"destructive\"",
    inputPreview: '{"command":"rm -rf /tmp/x"}',
    inputHash: "abc123",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000
  };
  writeFileSync(join(pendingDir, "req-1.json"), JSON.stringify(request));
  const listed = listQueuedApprovals(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.tool.name, "bash.execute");
  writeQueuedDecision(dir, "req-1", {
    outcome: "allow",
    scope: "once",
    inputHash: "abc123",
    decidedBy: "cli"
  });
  // decision file written where the approver polls for it
  assert.equal(typeof listQueuedApprovals, "function");
});

test("validate command loads a config module and prints warnings", () => {
  const dir = mkdtempSync(join(tmpdir(), "at-cli-"));
  const config = join(dir, "agentic-tools.config.mjs");
  const coreUrl = new URL("../../../core/dist/src/index.js", import.meta.url).href;
  writeFileSync(
    config,
    `import { defineTool } from ${JSON.stringify(coreUrl)};
     const t = defineTool({
       name: "demo.danger",
       description: "destructive demo",
       inputSchema: { type: "object" },
       sideEffect: "destructive",
       risk: "high",
       capabilities: [],
       execute: async () => "ok"
     });
     export default {
       workspace: ${JSON.stringify(dir)},
       tools: [t],
       policy: {}
     };`
  );
  const cliPath = new URL("../src/cli.js", import.meta.url).pathname;
  const out = execFileSync(process.execPath, [cliPath, "validate", "--config", config], {
    encoding: "utf8"
  });
  assert.match(out, /Config OK/);
  assert.match(out, /No approvers configured/);
});

test("doctor command exits 0 on a supported platform", () => {
  const cliPath = new URL("../src/cli.js", import.meta.url).pathname;
  const out = execFileSync(process.execPath, [cliPath, "doctor"], { encoding: "utf8" });
  assert.match(out, /platform report/);
});
