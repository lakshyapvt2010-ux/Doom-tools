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

const PAGE = `<!doctype html><title>Fixture</title><body>
<h1>Hello fixture</h1>
<input name="q" id="q" type="text">
<button id="b" onclick="document.body.dataset.clicked='yes';document.getElementById('out').textContent='clicked!'">Press</button>
<div id="out"></div>
<a href="https://example.com/x">Example link</a>
</body>`;

function serve(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    }).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

const ws = () => mkdtempSync(join(tmpdir(), "at-browsertest-"));
const kit = (tools: ReturnType<typeof browser>, policy?: object) =>
  createToolkit({ workspace: ws(), tools, approvers: [allowAllApprover()], policy } as never);
const granted = { capabilities: { "browser.control": true } };

test("navigate, dom, type, click and screenshot against a local fixture page", async (t) => {
  const { server, url } = await serve();
  try {
    const tools = browser({ allowPrivateNetwork: true });
    t.after(() => tools.close());
    const k = kit(tools, granted);
    const nav = await k.invoke("browser.navigate", { url });
    assert.equal(nav.status, "success");
    if (nav.status === "success") {
      const o = nav.output as { title: string; untrusted: boolean };
      assert.equal(o.title, "Fixture");
      assert.equal(o.untrusted, true);
    }

    const dom = await k.invoke("browser.dom", {});
    assert.equal(dom.status, "success");
    if (dom.status === "success") {
      const o = dom.output as { text: string; links: { href: string }[]; headings: { text: string }[] };
      assert.match(o.text, /Hello fixture/);
      assert.equal(o.links[0]?.href, "https://example.com/x");
      assert.equal(o.headings[0]?.text, "Hello fixture");
    }

    const typed = await k.invoke("browser.type", { selector: "#q", text: "agent" });
    assert.equal(typed.status, "success");

    const clicked = await k.invoke("browser.click", { selector: "#b" });
    assert.equal(clicked.status, "success");
    const after = await k.invoke("browser.dom", {});
    if (after.status === "success") {
      assert.match((after.output as { text: string }).text, /clicked!/);
    }

    const shot = await k.invoke("browser.screenshot", {});
    assert.equal(shot.status, "success");
    if (shot.status === "success") {
      const o = shot.output as { format: string; bytes: number; base64: string };
      assert.equal(o.format, "png");
      assert.ok(o.bytes > 1000);
      assert.ok(o.base64.length > 100);
    }

    const missing = await k.invoke("browser.click", { selector: "#nope" });
    assert.equal(missing.status === "error" && missing.error.code, "not_found");
  } finally { server.close(); }
});

test("browser.control grant is required (fail closed)", async () => {
  const k = kit(browser({ allowPrivateNetwork: true }));
  const r = await k.invoke("browser.navigate", { url: "http://127.0.0.1:9/" });
  assert.equal(r.status === "error" && r.error.code, "permission_denied");
});

test("schemes other than http(s) are refused before Chrome starts", async () => {
  const k = kit(browser({ allowPrivateNetwork: true }), granted);
  for (const url of ["file:///etc/passwd", "chrome://settings", "data:text/html,<h1>x</h1>"]) {
    const r = await k.invoke("browser.navigate", { url });
    assert.equal(r.status === "error" && r.error.code, "validation", url);
  }
});

test("private destinations are refused by default", async () => {
  const k = kit(browser(), granted);
  for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest", "http://localhost/"]) {
    const r = await k.invoke("browser.navigate", { url });
    assert.equal(r.status === "error" && r.error.code, "permission_denied", url);
  }
});

test("mapped IPv6 loopback is refused before Chrome starts", async (t) => {
 const tools=browser();t.after(()=>tools.close());
 const k=kit(tools,granted);
 const r=await k.invoke('browser.navigate',{url:'http://[::ffff:127.0.0.1]/'});
 assert.equal(r.status==='error'&&r.error.code,'permission_denied');
});
