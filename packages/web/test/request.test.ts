import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createToolkit} from "@agentic-tools/runtime";
import {allowAllApprover} from "@agentic-tools/security";
import {web} from "../src/index.js";

async function fixture(t: TestContext) {
 let hits=0;
 const server=createServer(async(req,res)=>{
  hits++;
  const chunks:Buffer[]=[]; for await(const c of req) chunks.push(c);
  if(req.url==='/redirect'){res.writeHead(307,{location:'/target'});res.end();return;}
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString(),header:req.headers['x-demo']}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const tools=web({only:['request'],allowPrivateNetwork:true});
 const workspace=()=>mkdtempSync(join(tmpdir(),'at-req-'));
 const policy={network:{allowHosts:['127.0.0.1']}};
 return {url,hits:()=>hits,k:createToolkit({workspace:workspace(),tools,policy,approvers:[allowAllApprover()]}),noApproval:createToolkit({workspace:workspace(),tools,policy}),noPolicy:createToolkit({workspace:workspace(),tools,approvers:[allowAllApprover()]})};
}

test('request is opt-in and statically high risk',()=>{
 assert.deepEqual(web().map(t=>t.name),['web.fetch']);
 const [tool]=web({only:['request']});
 assert.equal(tool!.risk,'high'); assert.equal(tool!.sideEffect,'external');
});
test('configurable methods and bodies reach loopback fixture',async(t)=>{
 const f=await fixture(t);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','GET']) {
  const r=await f.k.invoke('web.request',{url:f.url,method,headers:{'x-demo':'test'},...(method!=='GET'?{body:'fixture data'}:{})});
  assert.equal(r.status,'success');
  if(r.status==='success') {
   const o=r.output as {text:string;untrusted:boolean}; assert.equal(o.untrusted,true);
   const echo=JSON.parse(o.text); assert.equal(echo.method,method);assert.equal(echo.header,'test');
  }
 }
});
test('HTTP mutations require policy and approval before any network call',async(t)=>{
 const f=await fixture(t);
 const r=await f.noApproval.invoke('web.request',{url:f.url,method:'POST',body:'x'});
 assert.equal(r.status==='error'&&r.error.code,'approval_required');
 const d=await f.noPolicy.invoke('web.request',{url:f.url,method:'POST',body:'x'});
 assert.equal(d.status==='error'&&d.error.code,'permission_denied');assert.equal(f.hits(),0);
});
test('unsafe headers, oversize bodies and GET bodies are rejected',async(t)=>{
 const f=await fixture(t);
 for(const args of [{headers:{Authorization:'secret'}},{headers:{Host:'other.example'}},{headers:{'x-demo':'a\r\nb'}},{body:'x'.repeat(65537),method:'POST'},{body:'x',method:'GET'},{method:'CONNECT'}]){
  const r=await f.k.invoke('web.request',{url:f.url,...args}); assert.equal(r.status,'error');
 }
 assert.equal(f.hits(),0);
});
test('mutating redirects are returned without replaying body',async(t)=>{
 const f=await fixture(t);
 const r=await f.k.invoke('web.request',{url:f.url+'/redirect',method:'POST',body:'x'});
 assert.equal(r.status,'success');assert.equal(f.hits(),1);
 if(r.status==='success') assert.equal((r.output as {status:number}).status,307);
});
