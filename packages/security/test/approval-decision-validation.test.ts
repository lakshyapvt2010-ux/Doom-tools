import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalManager } from "../src/approvals.js";
import { createRedactor } from "../src/redact.js";

test("malformed approver decisions never count as explicit approval", async () => {
  const manager = new ApprovalManager({ redactor: createRedactor(), expiryMs: 1000 });
  for (const value of [undefined, {}, { outcome: "unexpected" }, "allow"]) {
    const request = manager.createRequest({ name: "test.approval", version: "1" }, {},
      { sideEffect: "destructive", risk: "high", capabilities: [] }, "fixture", "fixture");
    const decision = await manager.requestApproval(request, [{ name: "malformed", async approve() { return value as never; } }]);
    assert.equal(decision, null);
    assert.equal(manager.listPending().length, 0);
  }
});
