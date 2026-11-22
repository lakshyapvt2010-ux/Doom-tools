# Remaining work after the local implementation pass

This is a prototype, not a completed PRD or production release. The appendix is
a roadmap, not an instruction to build every integration it lists.

## Implementation and environment gaps

- PRD 14.2 Docker execution backend: implementation and six executable-double
  tests exist, but real container acceptance is pending. A local Docker daemon
  and image import succeeded; container startup failed on undelegated cgroups.
  See docs/docker.md and scripts/check-docker-integration.mjs. No host fallback.
- PRD 14.2 Windows filesystem/Git: native path-policy and Git portability fixes
  plus a native acceptance script exist. No Windows runner has been used, so
  support is not yet claimed.
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

- CI run 11 at 8a1df4a passed all six Ubuntu/macOS Node22/24/26 jobs, including
  Chrome cleanup. Two PostgreSQL server tests skipped everywhere, and one
  loopback-hostname check skipped on macOS. Newer local fixes are not covered.
  Latest local Linux matrix: 287 pass per Node22/24/26, zero skips, real PostgreSQL.
- Named desktop MCP clients and hosted model behavior remain untested. Local
  SDK mock/scripted models validate execution mechanics, not autonomous quality.
- A fresh source checkout passes frozen-lockfile installation from a cached
  store, build/typecheck, all 271 Linux Node22 tests at the earlier checkpoint, five examples and CLI smoke.
  The earlier empty-cache install had218 tests; it is separate evidence. No
  external developer has demonstrated the section-18 first-use gate.
- The competitive desk review is complete, but the 5-10 developer conversations,
  demand evidence and go/no-go decision remain open. No outreach was performed.
- Independent security review, release provenance checks, license and
  support-policy decisions are not complete. No packages published or deployed.

## Decisions that must stay explicit

- Search ships a provider interface only. Choosing a default vendor, obtaining
  credentials or incurring provider costs is a separate decision.
- A tokenizer hook supports exact model-specific counting, but no default model
  or tokenizer was chosen; the fallback estimate is approximate.
- License, publishing, deployment, interviews and any paid provider evaluation
  require separate owner decisions. Nothing here selects them automatically.
- Changes remain focused commits and existing pushed history is preserved.
  Documentation is not permission for a remote write or a fresh credential.
  Later releases can choose a different review structure.
