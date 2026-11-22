import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "../src/toolkit.js";

test("workspace aliases and policy capability paths share one canonical root", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "at-workspace-alias-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const real = join(base, "real"); mkdirSync(real);
  const alias = join(base, "alias"); symlinkSync(real, alias);
  const tool = defineTool({ name: "test.alias", description: "Workspace alias fixture", inputSchema: { type: "object" },
    sideEffect: "read", capabilities: ["filesystem.read"],
    classify: () => ({ sideEffect: "read", risk: "low", capabilities: [{ name: "filesystem.read", path: "." }] }),
    execute: async () => "ok" });
  const toolkit = createToolkit({ workspace: alias, tools: [tool] });
  assert.equal(toolkit.workspace, real);
  assert.equal((await toolkit.invoke(tool.name, {})).status, "success");
});
