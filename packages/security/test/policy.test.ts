import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalRuleFor,
  evaluatePolicy,
  isPathWithin,
  resolvePolicy
} from "../src/policy.js";
import type { ToolDefinition } from "@agentic-tools/core";

const tool = {
  name: "filesystem.write",
  version: "0.0.0",
  description: "t",
  inputSchema: {},
  sideEffect: "write",
  capabilities: ["filesystem.write"],
  risk: "medium",
  execute: async () => ({ status: "success", tool: { name: "t", version: "0" }, output: null })
} as unknown as ToolDefinition;

test("isPathWithin boundaries", () => {
  assert.equal(isPathWithin("/w", "/w"), true);
  assert.equal(isPathWithin("/w", "/w/a/b"), true);
  assert.equal(isPathWithin("/w", "/w2"), false);
  assert.equal(isPathWithin("/w", "/"), false);
});

test("workspace-only policy denies escapes and allows in-root paths", () => {
  const policy = resolvePolicy({ workspace: "/w" });
  const escape = evaluatePolicy(policy, tool, {
    sideEffect: "write",
    risk: "medium",
    capabilities: [{ name: "filesystem.write", path: "/etc/passwd" }]
  });
  assert.equal(escape.kind, "deny");
  const inside = evaluatePolicy(policy, tool, {
    sideEffect: "write",
    risk: "medium",
    capabilities: [{ name: "filesystem.write", path: "/w/a.txt" }]
  });
  // write side effect, no explicit approval rule: allowed without approval
  assert.equal(inside.kind, "allow");
});

test("unknown capabilities fail closed", () => {
  const policy = resolvePolicy({ workspace: "/w" });
  const decision = evaluatePolicy(policy, tool, {
    sideEffect: "read",
    risk: "low",
    capabilities: [{ name: "cloud.deploy", account: "prod" }]
  });
  assert.equal(decision.kind, "deny");
});

test("explicit capability constraints bind to paths", () => {
  const policy = resolvePolicy({
    workspace: "/w",
    capabilities: { "database.read": { paths: ["/w/db"] } }
  });
  const ok = evaluatePolicy(policy, tool, {
    sideEffect: "read",
    risk: "low",
    capabilities: [{ name: "database.read", path: "/w/db/app.db" }]
  });
  assert.equal(ok.kind, "allow");
  const no = evaluatePolicy(policy, tool, {
    sideEffect: "read",
    risk: "low",
    capabilities: [{ name: "database.read", path: "/var/lib/other.db" }]
  });
  assert.equal(no.kind, "deny");
});

test("network deny-by-default and allowHosts", () => {
  const denied = resolvePolicy({ workspace: "/w" });
  const deniedDecision = evaluatePolicy(denied, tool, {
    sideEffect: "external",
    risk: "medium",
    capabilities: [{ name: "network.http", host: "example.com" }]
  });
  assert.equal(deniedDecision.kind, "deny");
  const allowed = resolvePolicy({
    workspace: "/w",
    network: { allowHosts: ["*.example.com"] }
  });
  const d = evaluatePolicy(allowed, tool, {
    sideEffect: "external",
    risk: "medium",
    capabilities: [{ name: "network.http", host: "api.example.com" }]
  });
  assert.equal(d.kind, "approval"); // external side effect defaults to approval
});

test("approval defaults: destructive/external gated, read/write not", () => {
  const policy = resolvePolicy({ workspace: "/w" });
  const destructive = approvalRuleFor(policy, "bash.execute", {
    sideEffect: "destructive",
    risk: "high",
    capabilities: []
  });
  assert.equal(destructive.setting, "always");
  const read = approvalRuleFor(policy, "filesystem.read", {
    sideEffect: "read",
    risk: "low",
    capabilities: []
  });
  assert.equal(read.setting, "never");
});

test("explicit approval rules win over defaults", () => {
  const policy = resolvePolicy({
    workspace: "/w",
    approvals: { "filesystem.write": "ask", "bash.execute": "never" }
  });
  const ask = approvalRuleFor(policy, "filesystem.write", {
    sideEffect: "write",
    risk: "low",
    capabilities: [{ name: "filesystem.write", path: "/w/x" }]
  });
  assert.equal(ask.setting, "ask");
  const never = approvalRuleFor(policy, "bash.execute", {
    sideEffect: "destructive",
    risk: "high",
    capabilities: []
  });
  assert.equal(never.setting, "never");
});

test("policy evaluation returns approval decision with the triggering rule", () => {
  const policy = resolvePolicy({
    workspace: "/w",
    approvals: { "filesystem.write": "always" }
  });
  const d = evaluatePolicy(policy, tool, {
    sideEffect: "write",
    risk: "medium",
    capabilities: [{ name: "filesystem.write", path: "/w/a.txt" }]
  });
  assert.equal(d.kind, "approval");
  if (d.kind === "approval") assert.match(d.rule, /filesystem\.write/);
});
