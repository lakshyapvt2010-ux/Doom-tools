# Remaining work after the local implementation pass

This is a prototype, not a completed PRD or production release. The appendix is
a roadmap, not an instruction to build every integration it lists.

## Implementation and environment gaps

- PRD 14.2 Docker execution backend: not implemented. No Docker/Podman binary or
  daemon is available in the local validation environment. A real Docker-capable
  environment is needed for implementation and adversarial verification. Host
  bash is not containment; selecting an unavailable backend still fails closed.
- PRD 14.2 Windows filesystem/Git: not implemented or validated as supported.
  No Windows environment was used. Do not turn a workflow definition or portable
  TypeScript into a claim of Windows support.
- Strict final-result/wire budgets: successful JSON payloads have byte/token
  caps, but errors, envelope fields, warnings and adapter framing are outside
  those caps. Tool/provider allocations happen before runtime shaping.
- Browser networking: per-request checks cover redirects and subresources, and
  mapped-IPv6 destination handling is fixed. A DNS-rebinding window remains
  between validation and Chrome connecting. Private-network isolation is not
  guaranteed. A real egress boundary would need a separately verified design.
- Framework approval bridges: runtime approvals are enforced and failures keep
  stable codes. There is no native LangGraph/OpenAI interruption-resume bridge.
  Host approvers are required for approved execution.

## Validation and release gates

- New local commits after 4e3ac25 are not remotely CI-verified. Linux Node
  22/24/26 passing locally does not establish macOS success. PostgreSQL tests
  skip when server binaries are absent; a green job may therefore omit them.
- Named desktop MCP clients and hosted model behavior remain untested. Local
  SDK mock/scripted models validate execution mechanics, not autonomous quality.
- Fresh checkout, empty-cache dependency installation and five examples pass
  locally. No external developer has demonstrated the section-18 first-use gate.
- The competitive desk review is complete, but the 5-10 developer conversations,
  demand evidence and go/no-go decision remain open. No outreach was performed.
- Independent security review, release provenance/package checks, license and
  support-policy decisions are not complete. No packages published or deployed.

## Decisions that must stay explicit

- Search ships a provider interface only. Choosing a default vendor, obtaining
  credentials or incurring provider costs is a separate decision.
- A tokenizer hook supports exact model-specific counting, but no default model
  or tokenizer was chosen; the fallback estimate is approximate.
- License, publishing, deployment, interviews and any paid provider evaluation
  require separate owner decisions. Nothing here selects them automatically.
- The owner delegated remote organization: this pass keeps direct-to-main with
  focused, explained commits, rather than a PR stack. Existing pushed history
  is preserved; later releases can choose a different review structure.
