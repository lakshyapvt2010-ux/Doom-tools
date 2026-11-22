// Minimal stdio MCP server fixture using the repo's own adapter: echo + danger.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { serveMcp } from "@agentic-tools/adapter-mcp";

const echo = defineTool({
  name: "echo",
  description: "echoes",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  sideEffect: "read",
  execute: async ({ text }) => `echo:${text ?? ""}`
});
const danger = defineTool({
  name: "danger",
  description: "destructive",
  inputSchema: { type: "object" },
  sideEffect: "destructive",
  risk: "high",
  capabilities: [],
  execute: async () => "boom"
});
const toolkit = createToolkit({
  workspace: mkdtempSync(join(tmpdir(), "at-fixture-")),
  tools: [echo, danger],
  approvers: []
});
await serveMcp(toolkit, { name: "fixture" });
