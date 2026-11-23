import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'independent-stdio-app',version:'0.1.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['node_modules/agentic-tools/dist/cli/cli.js','serve','--config','agentic.config.mjs'],stderr:'pipe'});
try {await client.connect(transport);const listed=await client.listTools();assert.ok(listed.tools.some(t=>t.name==='filesystem.read'));const result=await client.callTool({name:'filesystem.read',arguments:{path:'README.md'}});assert.equal(result.structuredContent.status,'success');assert.match(result.structuredContent.output.content,/Independent Agentic Tools/);console.log('PASS real packaged CLI over child-process MCP stdio, tool discovery and file read');}finally{await client.close();}
