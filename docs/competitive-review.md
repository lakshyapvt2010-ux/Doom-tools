# Competitive and overlap review (PRD section 20)

Reviewed November 22, 2026, by public documentation and search results only. No interviews, outreach or hands-on trials were performed, so this answers the landscape questions with evidence pointers, not demand. The go/no-go gate also requires 5-10 developer conversations, which remain undone; treat every conclusion here as provisional until that half of the gate exists.

## Categories

### Framework-native tool sets and agent SDKs with permission systems
- Claude Agent SDK: deny rules, permission modes, allow rules and a `canUseTool`/`can_use_tool` callback, plus PreToolUse hooks that can allow, deny or modify calls (https://code.claude.com/docs/en/agent-sdk/permissions). Strong per-call control, but tied to Claude Code's runtime and model.
- OpenAI Agents SDK: tool-level `needs_approval`, run interruptions, `RunState` resume, and input/output guardrails (https://openai.github.io/openai-agents-python/human_in_the_loop/, /guardrails/). Approval and guardrails live inside the OpenAI orchestration loop.
- Vercel AI SDK: `needsApproval` on a tool (deprecated in favor of `toolApproval` on generateText/streamText/ToolLoopAgent per https://ai-sdk.dev/docs/agents/tool-approvals). Approval is a flag plus UI pattern; no capability model, path-scoped grants, or audit.
- LangChain/LangGraph: human-in-the-loop middleware and `interrupt()` with approve/edit/reject decisions (https://docs.langchain.com/oss/python/langchain/human-in-the-loop). Approval is orchestration state, not a policy engine; each framework reimplements it differently.

Implication: every major SDK has some approval hook, which validates the need, but each is scoped to its own loop and model provider. None offers one policy/audit layer the same tool passes through regardless of framework.

### Community and reference MCP servers
- modelcontextprotocol/servers: reference servers for filesystem, git, fetch and others (https://github.com/modelcontextprotocol/servers/). These are direct commodity overlaps for our filesystem/git/web built-ins, but they ship no shared policy, approval or audit layer; each server implements its own confinement (or doesn't).

### MCP gateways, proxies and control planes
This is the closest overlap and it grew fast:
- mcpgate: deny-by-default MCP firewall/proxy gating tools/call, resources/read, prompts/get and sampling (https://github.com/maksym-mishchenko/mcpgate).
- hoophq/mcpproxy: security gateway terminating Streamable HTTP, inspecting JSON-RPC both directions, bridging to stdio or remote backends (https://github.com/hoophq/mcpproxy).
- mcp-doorman: rate limiting per tool, human approval gates, audit log (https://github.com/Sushank05/mcp-doorman).
- mcp-control-plane: server registry with risk scoring plus a transparent policy gateway (https://github.com/TWe1v3/mcp-control-plane).
- mcp-hangar: deterministic allow/deny in MCP semantics per upstream/tool/arguments (https://github.com/mcp-hangar/mcp-hangar).

Implication for PRD question 2: the "policy-enforcing wrapper around tools we did not write" idea is real and contested. Several independent projects are building exactly the MCP-side proxy. Most are MCP-only; none spans MCP plus framework adapters with one contract, and most emphasize gateway deployment over a library a developer embeds in their own runtime.

### Guardrail and policy layers
- NeMo Guardrails: tool-call checks validating names, schemas and per-tool rules, plus tool-result checks (https://docs.nvidia.com/nemo/guardrails/about-nemo-guardrails-library/overview).
- Invariant Guardrails: contextual security layer for agentic tool use (https://invariantlabs.ai/blog/guardrails).
- Policy-as-code approaches (Cedar at a gateway, Rego in hooks) surveyed at https://www.ajayk.sh/blog/policy-as-code-guardrails-ai-agents-2026/.

These focus on content/behavior checks, often model-assisted; they generally do not own execution lifecycle, workspace confinement, cancellation, secret redaction or replay.

### Sandbox and execution providers
- E2B and Daytona: isolated VM sandboxes for agent code execution (https://e2b.dev/resources/best-code-execution-sandboxes-for-ai-agents). Complementary rather than competing: they answer "where does code run," not "which tool calls are allowed and audited."

## What this does and does not answer
1. Demand for a framework-independent policy/approval/audit layer: plausible. Five+ independent MCP gateways plus per-SDK approval features show people keep rebuilding this. The interviews must confirm whether developers want it as an embeddable library (our wedge) or as a deployed gateway.
2. Wrapper vs own tools: the gateway cluster says the wrapper mode has demand but also direct competition; our difference would be one contract across MCP client, MCP server and framework adapters, plus built-ins where owning the implementation is needed to enforce policy (filesystem confinement, git, shell).
3. Which built-ins to own: keep owning tools whose guarantees need the implementation (workspace confinement, private-address refusal at connect time, read-only sqlite). Commodity fetch/git MCP servers exist, but they carry no unified policy; integrating them via mcp-client with policy is already supported.

Provisional wedge statement (needs interview confirmation): "A policy-aware execution runtime with one canonical tool contract, embeddable as a library across MCP server, MCP client and framework adapters, with approvals, capability permissions, redaction, audit and replay that no gateway or single-framework SDK provides together."

## Still missing before the section 20 gate can pass
- 5-10 developer conversations (user-gated).
- A recorded go/no-go decision by the user.
