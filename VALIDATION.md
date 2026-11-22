# Validation status (PRD section 20 gate)

The PRD makes a competitive review and developer interviews a **go/no-go gate before the
P0 build is committed**. That gate has **not** been performed. This prototype was built at
the product owner's explicit instruction after being told the gate was still open, so the
review can evaluate something concrete. Nothing here should be read as evidence of demand.

## What has NOT happened (required by PRD 20)

- No dated competitor and overlap review across framework-native tool sets, agent SDKs,
  community MCP servers, guardrail/policy layers and sandbox providers.
- No conversations with 5-10 developers matching the primary persona (agent application
  engineer building coding/repository agents).
- No surviving one-sentence wedge statement produced from that evidence.
- The three section-20 questions (demand for a framework-independent policy layer;
  policy-wrapper vs built-in catalogue; which tools are worth owning) are UNANSWERED.

## What this prototype assumes (hypotheses, not findings)

1. The differentiation wedge is the policy-aware execution runtime, not protocol
   translation. MCP server is the primary distribution surface (P0).
2. JSON Schema is the canonical schema format; Zod is an authoring convenience
   (open decision 21.4).
3. P0 shell scope is trusted-host only, approval-gated, with a container sandbox backend
   in P1 (open decision 21.11).
4. The first framework adapter is the Vercel AI SDK (open decision 21.3).
5. Built-in tools worth owning at P0 are the ones where owning the implementation is
   needed to enforce policy: filesystem, shell, Git.

## Prototype gate (PRD 18) status

| Bar | Status |
| --- | --- |
| Reference coding agent completes a repository task set end to end through MCP and one framework adapter | PARTIAL: wiring exists and passes tests (`examples/coding-agent`, adapter contract tests); no scripted end-to-end task set yet |
| Adversarial suite (FR-023) shows zero policy bypasses | PASS locally: 16/16 in `packages/adversarial` (101 tests total across packages, Node 20 and 22) |
| Approval flow works end to end through MCP and one framework, incl. non-interactive denial | PASS in tests (MCP elicitation path is implemented but only exercised with a mock-free client without elicitation; a live eliciting client has not been tested) |
| Same tool behaves identically through MCP and the framework adapter | PASS for the covered paths (validation, selection, approval, errors) |
| External developers reach first invocation from a clean install without help | NOT TESTED: requires the section-20 interviews |

## Open product decisions taken provisionally in this build

- Approval rules: absent an explicit rule, destructive/external side effects require
  approval; read/write do not (PRD 9.4). "ask" rules may be remembered only when
  `policy.allowRememberedApprovals` is true (PRD 9.5).
- Approval expiry defaults to 5 minutes.
- Output budget defaults to 32 KiB serialized; invocation timeout defaults to 60s.
- Token footprint is estimated at 4 characters per token (PRD 8.6 approximation).
- Package names use the proposed `@agentic-tools/*` scope; npm availability and trademark
  are unchecked (open decision 21.1).

## Independent review round (2026-11-19)

An independent security review of the first build found eight issues. All were fixed and
verified against the reviewer's own reproduction scripts (r1-r7), which now show the
fixed behavior, plus new regression tests in the package and adversarial suites:

1. HIGH - named-command substring/regex matching let a compound command
   (`ls /tmp; touch pwned`) inherit `ls`'s read/low classification. Fixed: named-command
   matching is exact argv of one simple invocation; any shell operator, expansion,
   redirection, env-assignment prefix or path-addressed executable fails closed to
   destructive/high. Stale configs using the old `match` field also fail closed.
2. HIGH - `filesystem.grep` ran user regexes on the main thread; a catastrophic pattern
   blocked the event loop and defeated the runtime timeout. Fixed: scans run in an
   isolated worker thread terminated at the invocation deadline; pattern length and file
   size caps are defense in depth only. Regression test is externally bounded.
3. MEDIUM - the runtime awaited `execute` indefinitely when a tool ignored
   `ctx.signal`. Fixed: the deadline is enforced on the return via an explicit race; the
   timeout error states that non-cooperative host-side work may continue, and the docs
   no longer imply the runtime can stop it.
4. MEDIUM - bash children inherited the whole host `process.env`, leaking undeclared
   secrets into model-executed commands. Fixed: minimal allowlisted environment by
   default; `envAllowlist`/`env` are explicit opt-ins.
5. MEDIUM - a `classify` hook returning out-of-enum values bypassed fail-closed (no
   approval rule matched, so the default allowed). Fixed: the whole classification shape
   is validated; invalid values fall back to the declared static bounds.
6. LOW-MEDIUM - the file-queue approver honored decisions without the `inputHash`
   binding. Fixed: the binding is required; unbound, mismatched or malformed decisions
   are denied; unreadable (partially written) files are re-polled until expiry.
7. LOW - the CLI prompt approver counted as an out-of-band approver for MCP exposure,
   exposing tools nobody could approve over stdio. Fixed: approvers declare `usesStdio`;
   the stdio server disables them with a warning and never counts them for exposure.
8. LOW - remembered ("approve always") decisions never expired. Fixed: bounded store
   with TTL (default 1h), LRU eviction (default 256) and
   `toolkit.revokeRememberedApprovals()`.

Known limitations carried forward by that review, documented in docs/security.md:
time-of-check/time-of-use races in path containment (inherent to host filesystems; the
P1 container backend is the answer for hostile workloads), and the non-cooperative-tool
limit above.

## Scope gaps against the PRD (unchanged by the review round)

- PRD section 18 names five examples (coding agent, repository assistant, RAG agent,
  database assistant, browser agent); only the coding agent ships. The other four are
  deliberately absent from this build.
- Observability ships traces and audit events (FR-010/FR-015); aggregated metrics
  (PRD 16 observability, "Emit trace, metrics and audit events" in the section-8
  lifecycle) are NOT implemented.
- The Vercel adapter is verified structurally (contract tests against its structural
  CoreTool shape), not against a live model provider; MCP elicitation has not been
  exercised with a live eliciting client.
- The section-20 gate above remains undone; nothing in this build is evidence of demand.

## Before any alpha

Complete the section-20 gate, record its outcome in the PRD, and re-scope P0 if the
evidence says so (including the possible pivot to a policy-runtime-first product that wraps
existing MCP tools).
