# tch! (tch-tools)

A TypeScript-first toolkit for AI applications that need reusable tools with
permissions, human approval, audit records and output limits. It supplies tools
to your agent. It is not an LLM or an autonomous agent by itself.

**Alpha, not production-certified.** Tested on Linux Node 22/24/26, with earlier
Linux/macOS CI coverage. No hosted model quality claim. Native Windows, Docker
isolation and named desktop MCP applications are not certified. Browser and
Docker tools are intentionally excluded from this initial npm distribution.

## Install

Requires Node.js 22, 24 or 26. macOS/Linux are the intended platforms. Git tools
need `git`; trusted-host shell tools need `bash`.

```sh
npm install agentic-tools@alpha
```

This single package includes the runtime and selected tools. No separate
monorepo packages are needed. Detailed design guides are in `docs/`. Import
this package or its subpaths, as listed below.

## First working example, no API key

Save as `example.mjs` in a directory containing a README.md:

```js
import { createToolkit, filesystem } from 'agentic-tools';

const toolkit = createToolkit({
  workspace: process.cwd(),
  tools: filesystem({ only: ['read', 'list', 'search'] })
});
const result = await toolkit.invoke('filesystem.read', { path: 'README.md' });
console.log(JSON.stringify(result, null, 2));
console.log(toolkit.traceRecords());
```

Run `node example.mjs`. You get a structured success/error envelope, trace ID,
timing and bounded output. Calls to tools not selected for this toolkit are denied,
even if the model guesses their names. Paths outside the workspace are denied.

## Writing files and requesting approval

```js
import { createToolkit, filesystem, callbackApprover } from 'agentic-tools';
const toolkit = createToolkit({
  workspace: process.cwd(),
  tools: filesystem({ only: ['read', 'write'] }),
  policy: { approvals: { 'filesystem.write': 'always' } },
  approvers: [callbackApprover(async request => {
    // Replace with a real human decision. Never auto-allow model requests.
    console.log(request);
    return { outcome: 'deny' };
  })]
});
console.log(await toolkit.invoke('filesystem.write', {
  path: 'example.txt', content: 'This needs approval.'
}));
```

Approvals are bound to the exact input and expire. Without an available approver,
approval-gated actions fail closed. A callback is trusted application code, not a
model-controlled permission switch.

## MCP server for compatible applications

Create `agentic.config.mjs`:

```js
import { filesystem } from 'agentic-tools/filesystem';
export default { workspace: process.cwd(), tools: filesystem() };
```

```sh
npx agentic-tools doctor
npx agentic-tools validate --config agentic.config.mjs
npx agentic-tools tools list --config agentic.config.mjs --tokens
npx agentic-tools serve --config agentic.config.mjs
```

The last command speaks MCP over stdio. Point a compatible MCP application's
server configuration to that command and config path. Local SDK client/server
flows are tested, but no specific desktop application or your machine's setup
has been verified. Do not print your application's own logs to MCP stdout.

## Framework adapters and subpaths

| Import | Purpose |
| --- | --- |
| `agentic-tools` | Core helpers, runtime, security, filesystem, Git and Bash factories |
| `/core`, `/runtime`, `/security` | Canonical contract, execution and policy |
| `/filesystem`, `/git`, `/bash` | Read/edit files, Git operations, explicit trusted-host shell |
| `/adapter-mcp`, `/mcp-client` | MCP server and external untrusted tool client |
| `/adapter-vercel` | Vercel AI SDK tool definitions |
| `/adapter-langchain` | LangChain/LangGraph bridge; install compatible `@langchain/core` separately |
| `/adapter-openai-agents` | OpenAI Agents bridge; install compatible `@openai/agents` separately |
| `/web`, `/sqlite`, `/postgres` | Policy-gated HTTP/search interface and read-only database tools |
| `/testing`, `/cli` | Mock/record/replay helpers and CLI APIs |

Example Vercel wiring:

```js
import { jsonSchema } from 'ai';
import { toVercelAI } from 'agentic-tools/adapter-vercel';
const tools = toVercelAI(toolkit, {
  wrapSchema: jsonSchema,
  nameForTool: name => name.replaceAll('.', '_')
});
// Pass tools to the compatible AI SDK call. Choose your own model/provider.
```

No model provider is bundled, selected or paid for. Local integration coverage
uses actual SDKs and deterministic scripted models. Those tests establish tool
execution mechanics, not an agent's reasoning quality.

## Safety and limits

- Filesystem/Git are mediated, but shared-host path checks have TOCTOU limits.
- `bash({ mode: 'trusted-host' })` is explicit opt-in, runs with host privileges
  and is **not a sandbox**. It can reach the network regardless of HTTP policy.
- Known-secret redaction is best-effort. Keep secrets out of tool inputs and
  accessible workspace files. No blanket secret-containment guarantee.
- Tool data, web content and remote MCP results remain untrusted data.
- Runtime and MCP result budgets do not cap every provider/HTTP framing byte.
- Pause/resume tickets are process-local, not an authenticated multi-user service.
- This release does not complete product research, independent security review
  or the full future PRD roadmap.

## For evaluators

The project demonstrates one schema-defined tool contract, enforced selection,
per-call policy, exact-input approvals, cancellation, redaction, audit/traces and
framework/protocol translation. It is useful for a repository assistant, a
read-only data assistant, or wrapping external MCP tools with local policy.

The independent application test installs the packed release outside the main
workspace, repairs a deliberately broken repository fixture through real tool
calls, runs tests and commits the fix, while checking approval and denial paths.
Its model is scripted and disclosed, with no external API or model spending.
See `RELEASE-VALIDATION.md` for exact evidence and limits. The reproducible app
is included in `examples/evaluator-app`; copy it outside the installed package
and follow its README. Its optional AI SDK5 dependency has known advisories,
is not bundled here, and should not be adopted for production without review.
