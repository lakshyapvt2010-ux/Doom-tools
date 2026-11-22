import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { toVercelAI } from "../src/index.js";

test("provider name mapping keeps canonical runtime identity and rejects collisions", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-name-map-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const one = defineTool({ name: "read.one", description: "Read one", inputSchema: { type: "object" }, sideEffect: "read", execute: async () => "one" });
  const two = defineTool({ ...one, name: "read.two", execute: async () => "two" });
  const toolkit = createToolkit({ workspace, tools: [one, two] });
  const tools = toVercelAI(toolkit, { returnEnvelope: true, nameForTool: (name) => name.replaceAll(".", "_") });
  assert.deepEqual(Object.keys(tools), ["read_one", "read_two"]);
  assert.equal((await tools.read_one!.execute({}) as { tool: { name: string } }).tool.name, one.name);
  assert.throws(() => toVercelAI(toolkit, { nameForTool: () => "same" }), /unique/);
});
