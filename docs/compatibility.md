# Compatibility matrix

## Platforms and runtimes

| Component | macOS | Linux | Windows |
| --- | --- | --- | --- |
| core, runtime, security | Node 20, 22 (CI) | Node 20, 22 (CI) | untested |
| filesystem, git | yes | yes | not at P0 |
| bash (trusted-host) | yes | yes | no |

## MCP

- Transport: stdio (P0). Streamable HTTP is P1 (PRD 14.2).
- Server SDK: `@modelcontextprotocol/sdk` ^1.32.2.
- Client elicitation: when supported, approvals are presented by the client; when not,
  approval-gated tools are hidden unless an out-of-band approver exists. A live
  elicitation-capable client has not been exercised yet (VALIDATION.md).

| Client capability | Behavior |
| --- | --- |
| no elicitation, no toolkit approver | approval-gated tools hidden; calls `permission_denied` |
| no elicitation, toolkit approver present | all selected tools exposed; approvals via toolkit approvers |
| elicitation | approvals asked through the client first |

## Frameworks

- Vercel AI SDK: structural `CoreTool` shape; pass `wrapSchema: jsonSchema` from `ai` v5.
  Tested against the documented shape, not against a pinned `ai` release (PRD 10.1 notes
  version pinning is open decision 21.3/21.10).
- LangChain/LangGraph, OpenAI Agents SDK: P1 (PRD 14.2).
