import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {defineTool,failure} from "@agentic-tools/core";
import {createToolkit} from "@agentic-tools/runtime";
import {createMcpServer} from "../src/index.js";
async function fixture(t:any,execute:()=>Promise<unknown>,maxResultBytes:number,maxResultTokens?:number){
 const workspace=mkdtempSync(join(tmpdir(),"at-mcp-cap-"));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
 const tool=defineTool({name:"test.frame",description:"Frame fixture",inputSchema:{type:"object"},sideEffect:"read",execute});
 const kit=createToolkit({workspace,tools:[tool],policy:{budgets:{maxOutputBytes:10000,maxResultBytes,...(maxResultTokens?{maxResultTokens}:{})}},runtime:{countOutputTokens:s=>s.length}});
 const server=createMcpServer(kit);const client=new Client({name:"budget-fixture",version:"1"},{capabilities:{}});
 const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(a),server.connect(b)]);
 t.after(()=>client.close());return {kit,client};
}
test("MCP CallToolResult cap includes duplicate JSON text, structure and escaping",async t=>{
 const {kit,client}=await fixture(t,async()=> '"\\'.repeat(800),3000);
 const result=await client.callTool({name:"test.frame",arguments:{}});
 assert.ok(Buffer.byteLength(JSON.stringify(result))<=3000);
 const structured=result.structuredContent as any;
 assert.equal(structured.error.code,"resource_limit");assert.equal(structured.truncation.truncated,true);
 assert.deepEqual(JSON.parse((result.content as any)[0].text),structured);
 assert.equal(kit.traceRecords()[0]?.errorCode,"resource_limit");
});
test("MCP frame token cap uses final rendering, including failed calls",async t=>{
 const {kit,client}=await fixture(t,async()=>failure({name:"test.frame",version:"1"},{code:"provider_error",message:"x".repeat(1600)}),10000,1800);
 const result=await client.callTool({name:"test.frame",arguments:{}});
 assert.ok(JSON.stringify(result).length<=1800);
 assert.equal((result.structuredContent as any).error.code,"provider_error");
 assert.equal(kit.traceRecords()[0]?.errorCode,"provider_error");
});
