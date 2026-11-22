import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@agentic-tools/core";
import { createToolkit } from "@agentic-tools/runtime";
import { filesystem } from "@agentic-tools/filesystem";

// Local retrieval (RAG without providers): a custom keyword-retrieval tool
// over workspace markdown, then filesystem.read on the winning document. No
// embeddings, model, API key or network - retrieval quality is lexical only,
// which is the honest scope of this example. A host would swap the scoring
// for an embeddings provider later. Usage: node examples/rag-agent/index.mjs
const workspace = join(dirname(fileURLToPath(import.meta.url)), "workspace");

const terms = (s) => s.toLowerCase().match(/[a-z]{3,}/g) ?? [];

const retrieve = defineTool({
  name: "docs.retrieve",
  description: "Rank workspace markdown documents against a query by keyword overlap. Returns the best path and score.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Natural-language question" } },
    required: ["query"],
    additionalProperties: false
  },
  sideEffect: "read",
  capabilities: ["filesystem.read"],
  risk: "low",
  tags: ["retrieval", "read"],
  execute: async ({ query }, ctx) => {
    const { readdirSync } = await import("node:fs");
    const dir = join(ctx.workspace, "docs");
    const q = new Set(terms(query));
    const scored = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const words = terms(readFileSync(join(dir, f), "utf8"));
        const hits = words.filter((w) => q.has(w)).length;
        return { path: `docs/${f}`, score: q.size ? hits / q.size : 0 };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score === 0) return { found: false, ranked: scored.slice(0, 3) };
    return { found: true, path: best.path, score: Number(best.score.toFixed(3)), ranked: scored.slice(0, 3) };
  }
});

const toolkit = createToolkit({
  workspace,
  tools: [retrieve, ...filesystem({ only: ["read"] })],
  policy: { capabilities: { "filesystem.read": true } }
}).select({ sideEffect: ["read"] });

for (const question of ["How long do I have to return a purchase?", "When will my order arrive?"]) {
  const ranked = await toolkit.invoke("docs.retrieve", { query: question });
  console.log("Q:", question);
  console.log("  ranked:", JSON.stringify(ranked.output?.ranked));
  if (ranked.output?.found) {
    const doc = await toolkit.invoke("filesystem.read", { path: ranked.output.path });
    console.log("  answer source:", ranked.output.path, "->", (doc.output?.content ?? "").split("\n")[2]?.trim());
  }
}
