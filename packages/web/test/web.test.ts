import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createToolkit } from "@agentic-tools/runtime";
import { allowAllApprover } from "@agentic-tools/security";
import { isPrivateHost, web } from "../src/index.js";

let hits: string[] = [];
function serve(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/redir") { res.writeHead(302, { location: "http://example.invalid/x" }); res.end(); return; }
      if (req.url === "/bin") { res.writeHead(200, { "content-type": "image/png" }); res.end(Buffer.from([1, 2, 3])); return; }
      if (req.url === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.end("a".repeat(5000)); return; }
      res.writeHead(200, { "content-type": "text/plain" }); res.end("hello");
    }).listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}
const ws = () => mkdtempSync(join(tmpdir(), "at-web-"));
const kit = (tools: ReturnType<typeof web>, policy?: object) =>
  createToolkit({ workspace: ws(), tools, approvers: [allowAllApprover()], policy } as never);

test("network is denied by default even with approval", async () => {
  hits = [];
  const { server, port } = await serve();
  try {
    const r = await kit(web({ allowPrivateNetwork: true })).invoke("web.fetch", { url: `http://127.0.0.1:${port}/` });
    assert.equal(r.status === "error" && r.error.code, "permission_denied");
    assert.deepEqual(hits, []);
  } finally { server.close(); }
});

test("allowed host fetches text, labeled untrusted; needs approval without an approver", async () => {
  hits = [];
  const { server, port } = await serve();
  try {
    const policy = { network: { allowHosts: ["127.0.0.1"] } };
    const noApprover = createToolkit({ workspace: ws(), tools: web({ allowPrivateNetwork: true }), policy } as never);
    const denied = await noApprover.invoke("web.fetch", { url: `http://127.0.0.1:${port}/` });
    assert.equal(denied.status === "error" && denied.error.code, "approval_required");
    assert.deepEqual(hits, []);
    const r = await kit(web({ allowPrivateNetwork: true }), policy).invoke("web.fetch", { url: `http://127.0.0.1:${port}/` });
    assert.equal(r.status, "success");
    const out = r.status === "success" ? (r.output as { text: string; untrusted: boolean }) : undefined;
    assert.equal(out?.text, "hello");
    assert.equal(out?.untrusted, true);
  } finally { server.close(); }
});

test("other hosts stay denied when only one is allowed", async () => {
  const policy = { network: { allowHosts: ["example.com"] } };
  const r = await kit(web(), policy).invoke("web.fetch", { url: "http://other.example.org/" });
  assert.equal(r.status === "error" && r.error.code, "permission_denied");
});

test("redirects are returned, not followed", async () => {
  const { server, port } = await serve();
  try {
    const policy = { network: { allowHosts: ["127.0.0.1"] } };
    const r = await kit(web({ allowPrivateNetwork: true }), policy).invoke("web.fetch", { url: `http://127.0.0.1:${port}/redir` });
    const out = r.status === "success" ? (r.output as { redirect: string; status: number }) : undefined;
    assert.equal(out?.status, 302);
    assert.equal(out?.redirect, "http://example.invalid/x");
  } finally { server.close(); }
});

test("body is truncated with a marker; non-text is omitted", async () => {
  const { server, port } = await serve();
  try {
    const policy = { network: { allowHosts: ["127.0.0.1"] } };
    const toolkit = kit(web({ allowPrivateNetwork: true, maxBytes: 1024 }), policy);
    const big = await toolkit.invoke("web.fetch", { url: `http://127.0.0.1:${port}/big` });
    const b = big.status === "success" ? (big.output as { text: string; truncated: boolean }) : undefined;
    assert.equal(b?.truncated, true);
    assert.equal(b?.text.length, 1024);
    const bin = await toolkit.invoke("web.fetch", { url: `http://127.0.0.1:${port}/bin` });
    const o = bin.status === "success" ? (bin.output as { text: string; note: string }) : undefined;
    assert.equal(o?.text, "");
    assert.match(o?.note ?? "", /Non-text/);
  } finally { server.close(); }
});

test("private destinations are refused by default even when the host is allowlisted", async () => {
  hits = [];
  const { server, port } = await serve();
  try {
    const policy = { network: { allowHosts: ["127.0.0.1", "localhost", "169.254.169.254"] } };
    const toolkit = kit(web(), policy);
    for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, "http://169.254.169.254/latest"]) {
      const r = await toolkit.invoke("web.fetch", { url });
      assert.equal(r.status === "error" && r.error.code, "permission_denied", url);
    }
    assert.deepEqual(hits, []);
  } finally { server.close(); }
});

test("invalid URLs and embedded credentials are rejected", async () => {
  const toolkit = kit(web(), { network: "allow-all" });
  for (const url of ["not a url", "ftp://example.com/x", "http://user:pw@example.com/"]) {
    const r = await toolkit.invoke("web.fetch", { url });
    assert.equal(r.status, "error", url);
  }
});

test("isPrivateHost covers common private ranges", () => {
  for (const h of ["localhost", "10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "[::1]", "fd00::1", "::ffff:10.0.0.1", "foo.local"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1"]) assert.equal(isPrivateHost(h), false, h);
});

test("a name that is not private-looking but resolves to loopback is refused at connect time", async (t) => {
  const { lookup } = await import("node:dns/promises");
  try {
    const a = await lookup("ip6-localhost");
    if (a.address !== "::1" && a.address !== "127.0.0.1") return t.skip("resolver mapping unavailable");
  } catch {
    return t.skip("ip6-localhost does not resolve here");
  }
  hits = [];
  const { server, port } = await serve();
  try {
    const toolkit = kit(web(), { network: { allowHosts: ["ip6-localhost"] } });
    const r = await toolkit.invoke("web.fetch", { url: `http://ip6-localhost:${port}/` });
    assert.equal(r.status === "error" && r.error.code, "permission_denied");
    assert.deepEqual(hits, []);
  } finally { server.close(); }
});
