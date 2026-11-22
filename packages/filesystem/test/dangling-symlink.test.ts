import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@agentic-tools/core";
import { filesystem } from "../src/index.js";

test("dangling links to missing outside targets are denied for reads and writes", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "at-dangling-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const { mkdirSync } = await import("node:fs"); mkdirSync(root);
  const outside = join(base, "must-not-be-created.txt");
  symlinkSync(outside, join(root, "dangling.txt"));
  const context: ToolContext = { workspace: root, traceId: "dangling", signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} }, services: {} };
  for (const tool of filesystem({ only: ["read", "write"] })) {
    const result = await tool.execute({ path: "dangling.txt", content: "must stay inside" }, context);
    assert.equal(result.status === "error" && result.error.code, "permission_denied");
  }
  assert.equal(existsSync(outside), false);
});
