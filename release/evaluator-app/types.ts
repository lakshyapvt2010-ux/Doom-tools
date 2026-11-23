import { createToolkit, defineTool, filesystem } from 'agentic-tools';
const custom = defineTool({name:'app.hello',description:'Typed custom tool',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name']},sideEffect:'read',execute:input=>input.name.toUpperCase()});
const toolkit = createToolkit({workspace:'.',tools:[custom,...filesystem()]});
await toolkit.invoke('app.hello',{name:'Evaluator'});
