/** Local dispatch baseline, not a service-level promise or model benchmark. */
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineTool } from '../packages/core/dist/src/index.js';
import { createToolkit } from '../packages/runtime/dist/src/index.js';
const workspace=mkdtempSync(join(tmpdir(),'agentic-benchmark-'));
const count=Number(process.env.AGENTIC_BENCH_COUNT??2000);
if(!Number.isSafeInteger(count)||count<100||count>100000)throw new Error('Count must be between 100 and 100000.');
try{
 const toolkit=createToolkit({workspace,tools:[defineTool({name:'benchmark.echo',description:'Benchmark fixture',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},sideEffect:'read',execute:input=>input.value})]});
 for(let i=0;i<200;i++)await toolkit.invoke('benchmark.echo',{value:'warmup'});
 const durations=[];const start=performance.now();
 for(let i=0;i<count;i++){const t=performance.now();const r=await toolkit.invoke('benchmark.echo',{value:'small output'});if(r.status!=='success')throw new Error('Benchmark invocation failed.');durations.push(performance.now()-t);}
 const elapsed=performance.now()-start;durations.sort((a,b)=>a-b);
 console.log(JSON.stringify({node:process.version,platform:process.platform,count,totalMs:elapsed,meanMs:elapsed/count,p50Ms:durations[Math.floor(count*0.5)],p95Ms:durations[Math.floor(count*0.95)],p99Ms:durations[Math.floor(count*0.99)],scope:'sequential warm runtime invoke, small JSON, validation/policy/redaction/traces/audit/result budgets; excludes external I/O and hosted models'},null,2));
}finally{rmSync(workspace,{recursive:true,force:true});}
