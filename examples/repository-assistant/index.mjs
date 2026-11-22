import { resolve } from "node:path";
import { createToolkit } from "@agentic-tools/runtime";
import { filesystem } from "@agentic-tools/filesystem";
import { git } from "@agentic-tools/git";

// Read-only repository reconnaissance. No model, API key or remote is needed.
// Usage, from the monorepo root after install/build:
// node examples/repository-assistant/index.mjs /path/to/repository
const workspace = resolve(process.argv[2] ?? ".");
const toolkit = createToolkit({
  workspace,
  tools: [...filesystem({ only: ["list", "search", "read"] }), ...git({ only: ["status", "log"] })],
  runtime: { maxOutputBytes: 4096 }
}).select({ sideEffect: ["read"] });

for (const [name, input] of [
  ["git.status", {}],
  ["git.log", { limit: 5 }],
  ["filesystem.list", { limit: 10 }],
  ["filesystem.search", { pattern: "*README*", limit: 5 }]
]) {
  const result = await toolkit.invoke(name, input);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "error") process.exitCode = 1;
}
console.log(JSON.stringify({ footprint: toolkit.describeFootprint(), metrics: toolkit.metrics() }, null, 2));
