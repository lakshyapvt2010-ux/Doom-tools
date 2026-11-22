import { createServer } from "node:http";
import { createToolkit } from "@agentic-tools/runtime";
import { allowAllApprover } from "@agentic-tools/security";
import { browser } from "@agentic-tools/browser";

// Headless-browser reconnaissance over a bundled local page. No model, API
// key or external network is needed; the page is served on loopback and
// allowPrivateNetwork is set for exactly this demo. Usage, from the monorepo
// root after install/build: node examples/browser-agent/index.mjs
const PAGE = `<!doctype html><title>Catalog</title><body>
<h1>Parts catalog</h1>
<input id="filter" placeholder="filter">
<button id="go" onclick="document.getElementById('out').textContent='filtered: '+document.getElementById('filter').value">Apply</button>
<div id="out"></div>
<a href="https://example.com/spec">Spec sheet</a>
</body>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.on("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const tools = browser({ allowPrivateNetwork: true });
try {
  const toolkit = createToolkit({
    workspace: process.cwd(),
    tools,
    approvers: [allowAllApprover()],
    policy: { capabilities: { "browser.control": true } }
  });

  console.log("navigate:", JSON.stringify((await toolkit.invoke("browser.navigate", { url })).output));
  console.log("dom:", JSON.stringify((await toolkit.invoke("browser.dom", {})).output, null, 1).slice(0, 900));
  await toolkit.invoke("browser.type", { selector: "#filter", text: "bearings" });
  console.log("click:", JSON.stringify((await toolkit.invoke("browser.click", { selector: "#go" })).output));
  const after = await toolkit.invoke("browser.dom", {});
  console.log("after:", (after.output?.text ?? "").replace(/\s+/g, " ").trim());
  const shot = await toolkit.invoke("browser.screenshot", {});
  console.log("screenshot:", shot.output?.bytes, "bytes,", shot.output?.format);
} finally {
  await tools.close();
  server.close();
}
