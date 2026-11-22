import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerShell } from "../src/index.js";
import type { ToolContext } from "@agentic-tools/core";
const image = "alpine@sha256:" + "a".repeat(64);
function fixture(t: any, scenario = "ok") {
 const root = mkdtempSync(join(tmpdir(), "at-docker-"));
 t.after(() => rmSync(root, { recursive: true, force: true }));
 const binary = join(root, "fake-docker"); const log = join(root, "calls.jsonl");
 writeFileSync(binary, `#!${process.execPath}\nimport('node:fs').then(fs=>{const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');if(a.includes('run')){if(${JSON.stringify(scenario)}==='fail')process.exit(125);if(${JSON.stringify(scenario)}==='timeout'){setTimeout(()=>{},10000);return;}console.log('x'.repeat(100));}else if(a.includes('ps')&&${JSON.stringify(scenario)}==='cleanup'){console.log('remaining-container');}});\n`);
 chmodSync(binary, 0o700);
 const context: ToolContext = { workspace: root, traceId: "docker", signal: new AbortController().signal, services: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } };
 return {root,binary,log,context};
}
test("Docker isolation configuration rejects unsafe identities and unpinned images", () => {
 assert.throws(() => dockerShell({mode:"sandboxed-local",image:"alpine:latest"}), /digest/);
 assert.throws(() => dockerShell({mode:"sandboxed-local",image,user:"0:0"}), /non-root/);
 assert.throws(() => dockerShell({mode:"sandboxed-local",image,pidsLimit:0}), /positive/);
 assert.throws(() => dockerShell({mode:"trusted-host" as never,image}), /sandboxed-local/);
});
test("Docker declares worst-case approval and workspace effects", () => {
 const [tool]=dockerShell({mode:"sandboxed-local",image});
 assert.equal(tool?.sideEffect,"destructive"); assert.equal(tool?.risk,"high");
 assert.deepEqual(tool?.classify?.({command:"echo hi"}).capabilities,[{name:"process.execute"},{name:"filesystem.write",path:"."}]);
});
test("Docker mandatory isolation arguments are used with bounded output and verified removal", async t => {
 const f=fixture(t); const [tool]=dockerShell({mode:"sandboxed-local",image,executable:f.binary,maxOutputBytes:16});
 const result=await tool!.execute({command:"printf hi"},f.context);
 assert.equal(result.status,"success"); assert.equal(result.truncation?.truncated,true);
 const calls=readFileSync(f.log,"utf8").trim().split('\n').map(x=>JSON.parse(x) as string[]);
 for(const flag of ["--pull=never","--network=none","--read-only","--cap-drop=ALL","--security-opt=no-new-privileges:true","--pids-limit","--memory","--memory-swap","--cpus","--user","--ipc=private","--tmpfs"]) assert.ok(calls[0]!.includes(flag),flag);
 assert.ok(calls[0]!.includes(`type=bind,src=${f.root},dst=/workspace`));
 assert.equal(calls[0]!.filter(x=>x==="--mount").length,1);
 assert.equal(calls.at(-1)?.includes("ps"),true);
 assert.equal(calls[1]?.includes("--force"),true);
});
test("Docker refusal never executes on the host", async t => {
 const f=fixture(t,"fail"); const [tool]=dockerShell({mode:"sandboxed-local",image,executable:f.binary});
 const result=await tool!.execute({command:"echo hi"},f.context);
 assert.equal(result.status==="error"&&result.error.code,"execution_error");
});
test("Docker timeout removes the container independently of the cancelled launch", async t => {
 const f=fixture(t,"timeout"); const [tool]=dockerShell({mode:"sandboxed-local",image,executable:f.binary,maxTimeoutMs:200});
 const result=await tool!.execute({command:"sleep 100"},f.context);
 assert.equal(result.status==="error"&&result.error.code,"timeout");
 assert.ok(readFileSync(f.log,"utf8").includes('"--force"'));
});
test("Docker cleanup uncertainty is never reported as successful execution", async t => {
 const f=fixture(t,"cleanup"); const [tool]=dockerShell({mode:"sandboxed-local",image,executable:f.binary});
 const result=await tool!.execute({command:"echo hi"},f.context);
 assert.equal(result.status==="error"&&result.error.code,"execution_error");
});
