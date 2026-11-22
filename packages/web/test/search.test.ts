import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createToolkit } from "@agentic-tools/runtime";
import { allowAllApprover } from "@agentic-tools/security";
import { web, type SearchProvider } from "../src/index.js";

const ws = () => mkdtempSync(join(tmpdir(), "at-websearch-"));

const provider = (impl: SearchProvider["search"], host = "search.example.com"): SearchProvider => ({ host, search: impl });

const results = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}`, snippet: `s${i}` }));

test("factory refuses the search operation without a provider", () => {
  assert.throws(() => web({ only: ["search"] }), /searchProvider/);
});

test("search returns capped, untrusted results through policy and approval", async () => {
  let seenLimit = -1;
  const tools = web({
    only: ["search"],
    searchProvider: provider(async (_q, o) => { seenLimit = o.limit; return results(20); })
  });
  const policy = { network: { allowHosts: ["search.example.com"] } };
  const k = createToolkit({ workspace: ws(), tools, approvers: [allowAllApprover()], policy } as never);
  const r = await k.invoke("web.search", { query: "hello", limit: 50 });
  assert.equal(r.status, "success");
  assert.equal(seenLimit, 10); // clamped to the hard max
  if (r.status === "success") {
    const o = r.output as { untrusted: boolean; results: unknown[]; resultCount: number; providerHost: string };
    assert.equal(o.untrusted, true);
    assert.equal(o.resultCount, 10);
    assert.equal(o.providerHost, "search.example.com");
  }
});

test("search is denied when the provider host is not allowed, and needs approval without an approver", async () => {
  const tools = web({ only: ["search"], searchProvider: provider(async () => results(1)) });
  const wrongHost = createToolkit({
    workspace: ws(), tools, approvers: [allowAllApprover()],
    policy: { network: { allowHosts: ["other.example.org"] } }
  } as never);
  const denied = await wrongHost.invoke("web.search", { query: "x" });
  assert.equal(denied.status === "error" && denied.error.code, "permission_denied");

  const noApprover = createToolkit({
    workspace: ws(), tools, policy: { network: { allowHosts: ["search.example.com"] } }
  } as never);
  const needs = await noApprover.invoke("web.search", { query: "x" });
  assert.equal(needs.status === "error" && needs.error.code, "approval_required");
});

test("malformed provider results are dropped and reported", async () => {
  const tools = web({
    only: ["search"],
    searchProvider: provider(async () => [
      { title: "ok", url: "https://example.com/a" },
      { title: 42 as never, url: "https://example.com/b" },
      { title: "bad scheme", url: "file:///etc/passwd" },
      { title: "no url" } as never
    ])
  });
  const k = createToolkit({
    workspace: ws(), tools, approvers: [allowAllApprover()],
    policy: { network: { allowHosts: ["search.example.com"] } }
  } as never);
  const r = await k.invoke("web.search", { query: "x" });
  assert.equal(r.status, "success");
  if (r.status === "success") {
    const o = r.output as { results: { title: string }[]; note?: string };
    assert.deepEqual(o.results.map((x) => x.title), ["ok"]);
    assert.match(o.note ?? "", /3 malformed/);
  }
});

test("long titles and snippets are truncated; provider failure maps to provider_error", async () => {
  const long = web({
    only: ["search"],
    searchProvider: provider(async () => [{ title: "t".repeat(500), url: "https://example.com/", snippet: "s".repeat(1000) }])
  });
  const k = createToolkit({
    workspace: ws(), tools: long, approvers: [allowAllApprover()],
    policy: { network: { allowHosts: ["search.example.com"] } }
  } as never);
  const r = await k.invoke("web.search", { query: "x" });
  assert.equal(r.status, "success");
  if (r.status === "success") {
    const o = r.output as { results: { title: string; snippet: string }[] };
    assert.ok(o.results[0]!.title.length < 250 && o.results[0]!.title.endsWith("[truncated]"));
    assert.ok(o.results[0]!.snippet.length < 550 && o.results[0]!.snippet.endsWith("[truncated]"));
  }

  const failing = web({ only: ["search"], searchProvider: provider(async () => { throw new Error("boom"); }) });
  const k2 = createToolkit({
    workspace: ws(), tools: failing, approvers: [allowAllApprover()],
    policy: { network: { allowHosts: ["search.example.com"] } }
  } as never);
  const r2 = await k2.invoke("web.search", { query: "x" });
  assert.equal(r2.status === "error" && r2.error.code, "provider_error");

  const bad = web({ only: ["search"], searchProvider: provider(async () => null as never) });
  const k3 = createToolkit({
    workspace: ws(), tools: bad, approvers: [allowAllApprover()],
    policy: { network: { allowHosts: ["search.example.com"] } }
  } as never);
  const r3 = await k3.invoke("web.search", { query: "x" });
  assert.equal(r3.status === "error" && r3.error.code, "provider_error");
});

test("provider host is captured, output links are bounded and credentials refused", async () => {
  const p = provider(async () => [
    {title:"credentials", url:"https://user:password@example.com/"},
    {title:"huge", url:"https://example.com/" + "a".repeat(3000)},
    {title:"fine", url:"https://example.com/", publishedDate:"x".repeat(1000)}
  ]);
  const tools=web({only:["search"], searchProvider:p});
  p.host="other.example.org";
  const k=createToolkit({ workspace:ws(), tools, approvers:[allowAllApprover()], policy:{network:{allowHosts:["search.example.com"]}} } as never);
  const r=await k.invoke("web.search",{query:"x"});
  assert.equal(r.status,"success");
  if(r.status==='success') {
    const o=r.output as {providerHost:string; results:{publishedDate:string}[]; truncated:boolean};
    assert.equal(o.providerHost,'search.example.com');
    assert.equal(o.results.length,1); assert.equal(o.results[0]!.publishedDate.length,40);
    assert.equal(o.truncated,true);
  }
});
