import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText, jsonSchema, type ToolSet } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "@agentic-tools/adapter-mcp";
import { toVercelAI } from "@agentic-tools/adapter-vercel";
import { createToolkit } from "@agentic-tools/runtime";
import { callbackApprover } from "@agentic-tools/security";
import { filesystem } from "@agentic-tools/filesystem";
import { bash } from "@agentic-tools/bash";
import { git } from "@agentic-tools/git";
import { defineTool, type ToolResult } from "@agentic-tools/core";

// Deterministic protocol/SDK integration, not a claim of autonomous LLM quality.
// Each route operates in its own disposable repository and has no remote.
for (const route of ["mcp", "vercel-sdk"] as const) {
  test(`defined repository task: read, search, edit, test and commit through ${route}`, async (t) => {
    const workspace = mkdtempSync(join(tmpdir(), `at-repository-${route}-`));
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const runGit = (...args: string[]) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
    runGit("init", "-q");
    runGit("config", "user.name", "Repository Task Fixture");
    runGit("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(workspace, "sum.cjs"), "module.exports = (a, b) => a - b;\n");
    writeFileSync(join(workspace, "sum.test.cjs"), "require('node:assert/strict').equal(require('./sum.cjs')(2, 3), 5);\n");
    runGit("add", ".");
    runGit("commit", "-qm", "fixture baseline");
    let approvals = 0;
    const toolkit = createToolkit({ workspace,
      tools: [...filesystem({ only: ["read", "search", "edit"] }), ...bash({ mode: "trusted-host" }),
        ...git({ only: ["status", "add", "commit", "log"] })],
      policy: { capabilities: { "process.execute": true },
        approvals: { "filesystem.write": "always", "git.write": "always", "process.execute": "always" } },
      approvers: [callbackApprover(() => { approvals++; return { outcome: "allow", scope: "once" }; })]
    });
    let invoke: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
    if (route === "mcp") {
      const server = createMcpServer(toolkit);
      const client = new Client({ name: "repository-task", version: "1" }, { capabilities: {} });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      t.after(async () => { await client.close(); await server.close(); });
      invoke = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent as unknown as ToolResult;
    } else {
      const tools = toVercelAI(toolkit, { wrapSchema: schema => jsonSchema(schema as Parameters<typeof jsonSchema>[0]), returnEnvelope: true,
        nameForTool: (name) => name.replaceAll(".", "_") }) as ToolSet;
      invoke = async (name, args) => {
        const generated = await generateText({
          model: new MockLanguageModelV2({ doGenerate: {
            content: [{ type: "tool-call", toolCallId: "fixture-call", toolName: name.replaceAll(".", "_"), input: JSON.stringify(args) }],
            finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: []
          } }), tools, prompt: "Run the next deterministic repository task step.", maxRetries: 0
        });
        assert.equal(generated.toolResults.length, 1);
        return generated.toolResults[0]!.output as ToolResult;
      };
    }
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await invoke(name, args);
      assert.equal(result.status, "success", JSON.stringify(result));
      return result.status === "success" ? result.output as Record<string, unknown> : {};
    };
    assert.match(String((await call("filesystem.read", { path: "sum.cjs" })).content), /a - b/);
    const search = await call("filesystem.search", { pattern: "*.cjs" });
    assert.ok(JSON.stringify(search).includes("sum.cjs"));
    const before = await call("bash.execute", { command: "node sum.test.cjs" });
    assert.notEqual(before.exitCode, 0);
    await call("filesystem.edit", { path: "sum.cjs", edits: [{ find: "a - b", replace: "a + b" }] });
    assert.equal((await call("bash.execute", { command: "node sum.test.cjs" })).exitCode, 0);
    await call("git.add", { pathspec: ["sum.cjs"] });
    const committed = await call("git.commit", { message: "Fix addition fixture" });
    assert.match(String(committed.sha), /^[a-f0-9]{40}$/);
    assert.equal((await call("git.status", {})).clean, true);
    assert.match(readFileSync(join(workspace, "sum.cjs"), "utf8"), /a \+ b/);
    assert.equal(approvals, 5);
    assert.equal(toolkit.traceRecords().length, 8);
    assert.equal(toolkit.metrics().reduce((sum, row) => sum + row.count, 0), 8);
  });
}

test("real MCP elicitation accepts and denies exact calls without a host approver", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-elicitation-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  let executed = 0;
  const dangerous = defineTool({ name: "test.elicit", description: "Approval fixture", sideEffect: "destructive", risk: "high",
    inputSchema: { type: "object" }, execute: async () => { executed++; return "allowed"; } });
  const toolkit = createToolkit({ workspace, tools: [dangerous] });
  const server = createMcpServer(toolkit);
  const client = new Client({ name: "elicitation-fixture", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  let approve = true;
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { approve } }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  assert.equal((await client.listTools()).tools.length, 1);
  const allowed = await client.callTool({ name: dangerous.name, arguments: { step: 1 } });
  assert.equal((allowed.structuredContent as unknown as ToolResult).status, "success");
  approve = false;
  const denied = (await client.callTool({ name: dangerous.name, arguments: { step: 2 } })).structuredContent as unknown as ToolResult;
  assert.equal(denied.status === "error" && denied.error.code, "permission_denied");
  assert.equal(executed, 1);
  assert.deepEqual(toolkit.traceRecords().map((trace) => trace.approvalOutcome), ["allow", "deny"]);
});
