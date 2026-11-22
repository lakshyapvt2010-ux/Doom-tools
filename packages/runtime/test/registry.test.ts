import assert from "node:assert/strict";
import { test } from "node:test";
import { defineTool, type ToolDefinition } from "@agentic-tools/core";
import { ToolRegistry } from "../src/registry.js";

const tool = (version = "1.0.0") => defineTool({ name: "test.registry", version, description: "Registry fixture", inputSchema: { type: "object" }, sideEffect: "read", execute: () => "ok" });

test("registry resolves SemVer precedence independent of insertion order", () => {
  const registry = new ToolRegistry();
  for (const version of ["1.0.0", "1.0.0-rc.1", "1.0.0-beta.11", "1.0.0-beta.2", "1.0.0-alpha", "0.9.9"]) registry.register(tool(version));
  assert.equal(registry.resolve("test.registry")?.version, "1.0.0");
  assert.equal(registry.list()[0]?.version, "1.0.0");
  assert.equal(registry.resolve("test.registry", "1.0.0-beta.2")?.version, "1.0.0-beta.2");
  assert.throws(() => registry.register(tool("1.0.0")), /already registered/);
});

test("registry compares numeric prereleases and treats build metadata as equal precedence", () => {
  const registry = new ToolRegistry();
  registry.register(tool("1.0.0-beta.11")); registry.register(tool("1.0.0-beta.2"));
  assert.equal(registry.resolve("test.registry")?.version, "1.0.0-beta.11");
  registry.register(tool("1.0.0+build.1"));
  assert.equal(registry.resolve("test.registry")?.version, "1.0.0+build.1");
});

test("registry rejects invalid raw definitions before inserting them", () => {
  for (const patch of [{ name: "Invalid Name" }, { version: "" }, { risk: "other" }, { sideEffect: "other" }, { capabilities: [null] }, { execute: null }, { classify: "oops" }, { tags: [1] }, { description: " " }]) {
    const registry = new ToolRegistry();
    assert.throws(() => registry.register({ ...tool(), ...patch } as unknown as ToolDefinition), /Invalid tool metadata/);
    assert.deepEqual(registry.list(), []);
  }
});

test("registry rejects malformed input and output schemas at registration", () => {
  for (const patch of [{ inputSchema: [] }, { inputSchema: { type: "typo" } }, { inputSchema: { required: "bad" } }, { inputSchema: { $ref: "unknown-schema" } }, { outputSchema: { type: "typo" } }]) {
    const registry = new ToolRegistry();
    assert.throws(() => registry.register({ ...tool(), ...patch } as unknown as ToolDefinition), /schema/i);
    assert.deepEqual(registry.list(), []);
  }
});


test("registry preserves imported MCP identifiers and opaque versions", () => {
  const registry = new ToolRegistry();
  registry.register({ ...tool(), name: "Remote.tool-with-dash", version: "mcp-remote" });
  assert.equal(registry.resolve("Remote.tool-with-dash")?.version, "mcp-remote");
});
