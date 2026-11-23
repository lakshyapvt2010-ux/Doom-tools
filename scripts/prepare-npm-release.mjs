/** Build a single-install alpha artifact without publishing or choosing a license. */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.env.AGENTIC_RELEASE_DIR??'/tmp/agentic-release');
const name=process.env.AGENTIC_RELEASE_NAME??'agentic-tools';
const version=process.env.AGENTIC_RELEASE_VERSION??'0.1.0-alpha.1';
const license=process.env.AGENTIC_RELEASE_LICENSE??'UNLICENSED';
const packages=['core','security','runtime','filesystem','git','bash','web','sqlite','postgres','testing','mcp-client','adapter-mcp','adapter-vercel','adapter-langchain','adapter-openai-agents','cli'];
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
for(const pkg of packages){
 const source=join(root,'packages',pkg,'dist','src');const dest=join(out,'dist',pkg);mkdirSync(dest,{recursive:true});
 for(const file of readdirSync(source)){
  if(!file.endsWith('.js')&&!file.endsWith('.d.ts'))continue;
  const target=join(dest,file);
  const text=readFileSync(join(source,file),'utf8').replace(/(["'])@agentic-tools\/([a-z-]+)\1/g,(_,quote,dep)=>{
   if(!packages.includes(dep))throw new Error('Missing internal package '+dep);
   let path=relative(dirname(target),join(out,'dist',dep,'index.js')).split('\\').join('/');if(!path.startsWith('.'))path='./'+path;return quote+path+quote;
  }).replace(/^\/\/# sourceMappingURL=.*$/gm,'');
  writeFileSync(target,text);
 }
}
const exports={'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}};
for(const pkg of packages)exports['./'+pkg]={types:`./dist/${pkg}/index.d.ts`,import:`./dist/${pkg}/index.js`};
const entry=['core','runtime','security','filesystem','git','bash'].map(p=>`export * from './${p}/index.js';`).join('\n')+'\n';
writeFileSync(join(out,'dist/index.js'),entry);writeFileSync(join(out,'dist/index.d.ts'),entry);
writeFileSync(join(out,'package.json'),JSON.stringify({name,version,description:'Policy-aware TypeScript tools for AI agents: permissions, approvals, MCP, files, Git, shell and framework adapters.',type:'module',license,main:'./dist/index.js',types:'./dist/index.d.ts',exports,bin:{'agentic-tools':'./dist/cli/cli.js'},files:['dist','docs','examples','README.md','LICENSE','VALIDATION.md','RELEASE-VALIDATION.md'],engines:{node:'>=22'},dependencies:{'@modelcontextprotocol/sdk':'1.32.2',ajv:'8.20.0',pg:'8.13.0'},peerDependencies:{'@langchain/core':'~1.5.0','@openai/agents':'~0.22.0'},peerDependenciesMeta:{'@langchain/core':{optional:true},'@openai/agents':{optional:true}},keywords:['agent','tools','mcp','typescript','permissions','approvals'],publishConfig:{access:'public',tag:'alpha'}},null,2)+'\n');
cpSync(join(root,'docs'),join(out,'docs'),{recursive:true});
for(const file of readdirSync(join(out,'docs'))){
 const path=join(out,'docs',file);
 if(file.endsWith('.md'))writeFileSync(path,readFileSync(path,'utf8').replaceAll('@agentic-tools/','agentic-tools/'));
}
cpSync(join(root,'release/evaluator-app'),join(out,'examples/evaluator-app'),{recursive:true});
cpSync(join(root,'release/VALIDATION.md'),join(out,'RELEASE-VALIDATION.md'));
cpSync(join(root,'VALIDATION.md'),join(out,'VALIDATION.md'));
// Add only a release-facing README. Never include the PRD, git history or tests.
cpSync(join(root,'release/README.md'),join(out,'README.md'));
if(license==='MIT')cpSync(join(root,'release/LICENSE-MIT'),join(out,'LICENSE'));
console.log(JSON.stringify({directory:out,name,version,license,packages,experimentalExcluded:['browser','docker']},null,2));
