import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { success, defineTool } from "@agentic-tools/core";
import { createToolkit } from "../src/toolkit.js";
import { shapeResult } from "../src/shaping.js";

const ref = { name: "test.output", version: "1" };
test("UTF-8 truncation never cuts a code point or miscounts omitted bytes", () => {
  const result = shapeResult(success(ref, "€€€"), 4);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.equal(result.output, "€");
    assert.equal(result.truncation?.omitted, 6);
    assert.ok(!result.output.includes("\ufffd"));
  }
});

test("runtime shortening never returns a cursor past omitted page items", () => {
  const result = shapeResult(success(ref, { items: Array.from({ length: 8 }, (_, i) => "entry-" + i), nextCursor: "past-all-eight" }), 80);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.ok(result.output.items.length < 8);
    assert.equal("nextCursor" in result.output, false);
    assert.match(result.truncation?.continuation ?? "", /SAME input cursor/);
  }
});

test("a non-serializable tool result still gets a safe terminal trace", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-output-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const tool = defineTool({ name: "test.bigint", description: "Invalid output fixture", inputSchema: { type: "object" }, sideEffect: "read", execute: async () => 1n });
  const toolkit = createToolkit({ workspace, tools: [tool] });
  const result = await toolkit.invoke(tool.name, {});
  assert.equal(result.status === "error" && result.error.code, "execution_error");
  assert.equal(toolkit.traceRecords().length, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("failed optional audit sink is visible without losing the memory audit or result", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "at-audit-sink-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const tool = defineTool({ name: "test.audit", description: "Audit failure fixture", inputSchema: { type: "object" }, sideEffect: "read", execute: async () => "ok" });
  const toolkit = createToolkit({ workspace, tools: [tool], auditSinks: [{ record() { throw new Error("sink unavailable"); } }] });
  const result = await toolkit.invoke(tool.name, {});
  assert.equal(result.status, "success");
  assert.match(result.warnings?.[0] ?? "", /audit sink failed/);
  assert.equal(toolkit.auditEvents().filter((event) => event.type === "invocation.end").length, 1);
  assert.equal(toolkit.traceRecords().length, 1);
});
