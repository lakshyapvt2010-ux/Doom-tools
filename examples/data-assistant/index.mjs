import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createToolkit } from "@agentic-tools/runtime";
import { sqlite } from "@agentic-tools/sqlite";
import { filesystem } from "@agentic-tools/filesystem";

// Read-only database reconnaissance over a seeded SQLite file. No model, API
// key or remote is needed. Usage, from the monorepo root after install/build:
// node examples/data-assistant/index.mjs
const workspace = join(dirname(fileURLToPath(import.meta.url)), "workspace");

const db = new DatabaseSync(join(workspace, "shop.db"));
db.exec(`CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, item TEXT, cents INTEGER);
INSERT OR IGNORE INTO orders VALUES (1,'book',1299),(2,'pen',350),(3,'lamp',4200);`);
db.close();

const toolkit = createToolkit({
  workspace,
  tools: [...sqlite(), ...filesystem({ only: ["list"] })],
  policy: { capabilities: { "sqlite.read": true } }
}).select({ sideEffect: ["read"] });

for (const [name, input] of [
  ["sqlite.query", { database: "shop.db", sql: "SELECT item, cents FROM orders WHERE cents > ? ORDER BY cents", params: [300] }],
  ["sqlite.query", { database: "shop.db", sql: "DELETE FROM orders" }],
  ["filesystem.list", { limit: 5 }]
]) {
  const result = await toolkit.invoke(name, input);
  console.log(name, JSON.stringify(result.status === "success" ? result.output : result.error, null, 2));
}
