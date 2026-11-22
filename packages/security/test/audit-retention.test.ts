import assert from "node:assert/strict";
import test from "node:test";
import { memoryAuditSink, newAuditEvent } from "../src/audit.js";

test("memory audit sink is bounded and counts dropped events", () => {
  const sink = memoryAuditSink(undefined, 50);
  for (let i = 0; i < 120; i++) sink.record(newAuditEvent("invocation.start", `t${i}`));
  assert.equal(sink.events.length, 50);
  assert.equal(sink.dropped, 70);
  assert.equal(sink.events.at(-1)?.traceId, "t119");
  assert.equal(sink.events[0]?.traceId, "t70");
});

test("memory audit sink keeps every event under the limit", () => {
  const sink = memoryAuditSink(undefined, 10);
  for (let i = 0; i < 10; i++) sink.record(newAuditEvent("invocation.end", `t${i}`));
  assert.equal(sink.events.length, 10);
  assert.equal(sink.dropped, 0);
});
