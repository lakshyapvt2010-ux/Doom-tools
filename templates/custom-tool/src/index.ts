import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";

const greeting = defineTool({
  name: "example.greet",
  description: "Return a local greeting without network access",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
    required: ["name"],
    additionalProperties: false
  },
  sideEffect: "read",
  capabilities: [],
  execute: ({ name }) => ({ greeting: `Hello, ${name.trim()}!` })
});

const toolkit = createToolkit({ workspace: process.cwd(), tools: [greeting] });
const result = await toolkit.invoke("example.greet", { name: "developer" });
if (result.status !== "success") throw new Error("The local example did not succeed");
console.log(JSON.stringify(result));
