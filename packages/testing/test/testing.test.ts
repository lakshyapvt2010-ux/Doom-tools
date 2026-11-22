import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ToolError, defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import {
  mockTool,
  parseRecording,
  recordTools,
  replayTools,
  serializeRecording
} from "../src/index.js";

let realCalls = 0;
const lookup = defineTool<{ id: string; opts?: { b: number; a: number } }, { name: string }>({
  name: "users.lookup",
  description: "Look up a user",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, opts: { type: "object" } },
    required: ["id"],
    additionalProperties: false
  },
  sideEffect: "read",
  capabilities: [],
  risk: "low",
  execute: ({ id }) => {
    realCalls += 1;
    if (id === "missing") throw new ToolError("not_found", "no such user");
    return { name: `user-${id}` };
  }
});

const workspace = () => mkdtempSync(join(tmpdir(), "at-testing-"));
const kit = (tools: ReturnType<typeof recordTools>["tools"]) =>
  createToolkit({ workspace: workspace(), tools });

test("mockTool replaces execution and records calls, errors map to stable codes", async () => {
  const mock = mockTool(lookup, ({ id }) => {
    if (id === "bad") throw new ToolError("conflict", "nope");
    return { name: "mocked" };
  });
  const toolkit = kit([mock.tool]);
  const ok = await toolkit.invoke("users.lookup", { id: "1" });
  assert.equal(ok.status, "success");
  const bad = await toolkit.invoke("users.lookup", { id: "bad" });
  assert.equal(bad.status, "error");
  assert.equal(bad.status === "error" && bad.error.code, "conflict");
  assert.equal(mock.calls.length, 2);
});

test("record then replay returns the same results without running the real tool", async () => {
  realCalls = 0;
  const recorder = recordTools([lookup]);
  const live = kit(recorder.tools);
  const a = await live.invoke("users.lookup", { id: "1" });
  const b = await live.invoke("users.lookup", { id: "missing" });
  assert.equal(realCalls, 2);

  const text = serializeRecording(recorder.recording());
  const replay = replayTools([lookup], parseRecording(text));
  const toolkit = kit(replay.tools);
  const a2 = await toolkit.invoke("users.lookup", { id: "1" });
  const b2 = await toolkit.invoke("users.lookup", { id: "missing" });
  assert.equal(realCalls, 2, "replay must not execute the real tool");
  assert.deepEqual(a2.status === "success" && a2.output, a.status === "success" && a.output);
  assert.equal(b2.status === "error" && b2.error.code, "not_found");
  assert.equal(replay.unconsumed().length, 0);
});

test("input key order does not affect matching; repeated calls replay in order", async () => {
  const recorder = recordTools([lookup]);
  await kit(recorder.tools).invoke("users.lookup", { id: "1", opts: { a: 1, b: 2 } });
  const replay = replayTools([lookup], recorder.recording());
  const r = await kit(replay.tools).invoke("users.lookup", { opts: { b: 2, a: 1 }, id: "1" });
  assert.equal(r.status, "success");
});

test("unmatched replay call fails not_found and never falls through", async () => {
  realCalls = 0;
  const replay = replayTools([lookup], { recordingVersion: 1, interactions: [] });
  const r = await kit(replay.tools).invoke("users.lookup", { id: "9" });
  assert.equal(r.status === "error" && r.error.code, "not_found");
  assert.equal(realCalls, 0);
});

test("a replayed call is consumed once; extra identical calls fail", async () => {
  const recorder = recordTools([lookup]);
  await kit(recorder.tools).invoke("users.lookup", { id: "1" });
  const replay = replayTools([lookup], recorder.recording());
  const toolkit = kit(replay.tools);
  assert.equal((await toolkit.invoke("users.lookup", { id: "1" })).status, "success");
  assert.equal((await toolkit.invoke("users.lookup", { id: "1" })).status, "error");
});

test("recording redaction removes secrets from stored input and result", async () => {
  const secret = defineTool<{ q: string }, { echo: string }>({
    ...lookup,
    name: "echo",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    execute: ({ q }: { q: string }) => ({ echo: q })
  } as never);
  const recorder = recordTools([secret], { redact: (t) => t.replaceAll("hunter2", "[REDACTED]") });
  await kit(recorder.tools).invoke("echo", { q: "pw hunter2" });
  const text = serializeRecording(recorder.recording());
  assert.equal(text.includes("hunter2"), false);
  assert.ok(text.includes("[REDACTED]"));
});

test("replay keeps runtime policy: selection still rejects hidden tools", async () => {
  const recorder = recordTools([lookup]);
  await kit(recorder.tools).invoke("users.lookup", { id: "1" });
  const replay = replayTools([lookup], recorder.recording());
  const toolkit = kit(replay.tools).select({ sideEffect: ["write"] });
  const r = await toolkit.invoke("users.lookup", { id: "1" });
  assert.equal(r.status === "error" && r.error.code, "permission_denied");
});

test("parseRecording rejects malformed or unsupported recordings", () => {
  assert.throws(() => parseRecording("{}"));
  assert.throws(() => parseRecording('{"recordingVersion":2,"interactions":[]}'));
  assert.throws(() => parseRecording('{"recordingVersion":1,"interactions":[{"tool":1}]}'));
});
