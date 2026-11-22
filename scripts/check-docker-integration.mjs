/** Explicit opt-in real Docker acceptance check. Does not pull images.
 * Usage: AGENTIC_DOCKER_IMAGE=alpine@sha256:<digest> node scripts/check-docker-integration.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerShell } from '../packages/docker/dist/src/index.js';
import { createToolkit } from '../packages/runtime/dist/src/index.js';
import { callbackApprover } from '../packages/security/dist/src/index.js';
const image = process.env.AGENTIC_DOCKER_IMAGE;
assert.ok(image, 'Set AGENTIC_DOCKER_IMAGE to a locally installed digest-pinned image with /bin/sh.');
execFileSync('docker', ['--host','unix:///var/run/docker.sock','image','inspect',image], {stdio:'inherit'});
const root=mkdtempSync(join(tmpdir(),'agentic-docker-live-')); chmodSync(root,0o777);
const outside=mkdtempSync(join(tmpdir(),'agentic-docker-outside-')); const sentinel=join(outside,'sentinel');writeFileSync(sentinel,'host-only-canary');
const workspace=join(root,'workspace.txt');writeFileSync(workspace,'before');chmodSync(workspace,0o666);
try {
 const toolkit=createToolkit({workspace:root,tools:dockerShell({mode:'sandboxed-local',image,maxTimeoutMs:5000}),approvers:[callbackApprover(()=>({outcome:'allow'}))]});
 const checks=[
  ['workspace write', 'printf after > /workspace/workspace.txt; cat /workspace/workspace.txt', /after/],
  ['non-root', 'test "$(id -u)" != 0 && echo nonroot', /nonroot/],
  ['read-only root', 'if touch /rootfs-escape 2>/dev/null; then exit 90; else echo readonly; fi', /readonly/],
  ['no host path', `test ! -e '${sentinel}' && test ! -e /var/run/docker.sock && echo isolated`, /isolated/],
  ['no external interface', 'test ! -d /sys/class/net/eth0 && echo no-eth0', /no-eth0/],
  ['bounded filesystem', 'test -w /tmp && echo tmp-ok', /tmp-ok/]
 ];
 for(const [label,command,expected] of checks){const r=await toolkit.invoke('docker.execute',{command});assert.equal(r.status,'success',label+': '+JSON.stringify(r));assert.equal(r.output.exitCode,0,label);assert.match(r.output.stdout,expected,label);console.log('PASS '+label);}
 assert.equal(readFileSync(workspace,'utf8'),'after');assert.equal(readFileSync(sentinel,'utf8'),'host-only-canary');
 const timeout=await toolkit.invoke('docker.execute',{command:'sleep 30',timeoutMs:200});assert.equal(timeout.status==='error'&&timeout.error.code,'timeout');
 const controller=new AbortController();const pending=toolkit.invoke('docker.execute',{command:'sleep 30'},{signal:controller.signal});setTimeout(()=>controller.abort(),200);const cancelled=await pending;assert.equal(cancelled.status==='error'&&cancelled.error.code,'cancelled');
 // Runtime cancellation may stop waiting before tool teardown completes.
 await new Promise(resolve=>setTimeout(resolve,1500));
 const remaining=execFileSync('docker',['--host','unix:///var/run/docker.sock','ps','--all','--filter','name=^/agentic-','--format','{{.ID}}'],{encoding:'utf8'});assert.equal(remaining.trim(),'');
 console.log('PASS timeout, cancellation and no remaining test containers');
} finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
