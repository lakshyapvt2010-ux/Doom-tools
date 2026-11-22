import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createToolkit } from "@agentic-tools/runtime";
import { allowAllApprover } from "@agentic-tools/security";
import { browser } from "../src/index.js";

// Subresources and a redirect chain exercise the Fetch interception: every
// request, not just the first navigation, must be validated and continued.
const PAGE = `<!doctype html><title>Intercept</title><body>
<h1>intercepted page</h1>
<img src="/pixel.gif">
<script src="/app.js"></script>
<iframe src="/frame.html"></iframe>
</body>`;

const hits: string[] = [];
function serve(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/redir") {
        res.writeHead(302, { location: "/final" });
        res.end();
        return;
      }
      if (req.url === "/redir-dead") {
        res.writeHead(302, { location: "http://nonexistent.invalid/x" });
        res.end();
        return;
      }
      if (req.url === "/final") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<title>Final Page</title><h1>arrived</h1>");
        return;
      }
      if (req.url === "/pixel.gif") {
        res.writeHead(200, { "content-type": "image/gif" });
        res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
        return;
      }
      if (req.url === "/app.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("window.__loaded = true;");
        return;
      }
      if (req.url === "/frame.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<title>frame</title>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    }).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const ws = () => mkdtempSync(join(tmpdir(), "at-browserint-"));
const kit = (tools: ReturnType<typeof browser>) =>
  createToolkit({
    workspace: ws(),
    tools,
    approvers: [allowAllApprover()],
    policy: { capabilities: { "browser.control": true } }
  } as never);

test("redirect chains and subresources pass through per-request validation", async (t) => {
  hits.length = 0;
  const { server, url } = await serve();
  const tools = browser({ allowPrivateNetwork: true });
  t.after(() => tools.close());
  try {
    const k = kit(tools);
    const nav = await k.invoke("browser.navigate", { url: `${url}/redir` });
    assert.equal(nav.status, "success");
    if (nav.status === "success") {
      const o = nav.output as { title: string; url: string };
      assert.equal(o.title, "Final Page");
      assert.match(o.url, /\/final$/);
    }
    assert.ok(hits.includes("/redir") && hits.includes("/final"), `hits: ${hits.join(",")}`);

    hits.length = 0;
    const nav2 = await k.invoke("browser.navigate", { url: `${url}/` });
    assert.equal(nav2.status, "success");
    // Subresources were individually validated and continued.
    await new Promise((r) => setTimeout(r, 700));
    assert.ok(hits.includes("/app.js"), `missing script: ${hits.join(",")}`);
    assert.ok(hits.includes("/pixel.gif"), `missing image: ${hits.join(",")}`);
    assert.ok(hits.includes("/frame.html"), `missing iframe: ${hits.join(",")}`);
  } finally { server.close(); }
});

test("a redirect to an unresolvable or refused destination is blocked, not followed", async (t) => {
  const { server, url } = await serve();
  const tools = browser({ allowPrivateNetwork: true });
  t.after(() => tools.close());
  try {
    const k = kit(tools);
    const r = await k.invoke("browser.navigate", { url: `${url}/redir-dead` });
    assert.equal(r.status, "error");
    if (r.status === "error") assert.match(r.error.message, /Navigation failed|timed out/i);
    const dom = await k.invoke("browser.dom", {});
    if (dom.status === "success") {
      assert.doesNotMatch((dom.output as { url: string }).url, /nonexistent\.invalid/);
    }
  } finally { server.close(); }
});
