# Remaining work after the local implementation pass

This is a prototype, not a completed PRD or production release. The appendix is
a roadmap, not an instruction to build every integration it lists.

## Implementation and environment gaps

- Docker and native Windows filesystem/Git acceptance passed in run17. Wider
  Windows tool support, other Docker host platforms and independent security
  certification remain unclaimed. Source changes are not a new npm release.
- Strict arbitrary transport-wire budgets remain open. Whole runtime results
  and MCP CallToolResult representations have byte/token caps, including errors,
  warnings, duplicate MCP content and escaping. JSON-RPC/HTTP framing and
  SDK/provider-owned messages remain outside them. Tool allocations precede
  shaping.
- Browser networking: per-request checks cover redirects and subresources, and
  mapped-IPv6 destination handling is fixed. A DNS-rebinding window remains
  between validation and Chrome connecting. Private-network isolation is not
  guaranteed. A real egress boundary would need a separately verified design.
- Opt-in LangGraph and OpenAI Agents native approval bridges now use runtime
  tickets with expiry and single-use checks. Ticket persistence across process
  restart and authenticated multi-user approval services are not provided.

## Validation and release gates

- Current source passed all eight jobs in [run17](https://github.com/MRIARC-08/tch-/actions/runs/45189379629).
  See VALIDATION.md for scope, earlier failures and skipped database coverage.
- Named desktop MCP clients and hosted model behavior remain untested. Local
  SDK mock/scripted models validate execution mechanics, not autonomous quality.
- A fresh source checkout passes frozen-lockfile installation from a cached
  store, build/typecheck, all 271 Linux Node22 tests at the earlier checkpoint, five examples and CLI smoke.
  The earlier empty-cache install had218 tests; it is separate evidence. No
  external developer has demonstrated the section-18 first-use gate.
- The competitive desk review is complete, but the 5-10 developer conversations,
  demand evidence and go/no-go decision remain open. No outreach was performed.
- Independent security review, release provenance checks and a support policy
  remain open. The owner approved MIT and published `@mriarc/tch-tools`
  `0.1.0-alpha.2`; both `latest` and `alpha` tags select it. Browser and Docker
  are excluded from that npm artifact. Native environment checks below do not
  change the published artifact or establish production certification.

## Decisions that must stay explicit

- Search ships a provider interface only. Choosing a default vendor, obtaining
  credentials or incurring provider costs is a separate decision.
- A tokenizer hook supports exact model-specific counting, but no default model
  or tokenizer was chosen; the fallback estimate is approximate.
- Future publication, deployment, interviews and paid provider evaluation require
  separate owner decisions. MIT and the existing alpha publication are approved;
  nothing here authorizes a later release or new spending.
- Changes remain focused commits and existing pushed history is preserved.
  Documentation is not permission for a remote write or a fresh credential.
  Later releases can choose a different review structure.
