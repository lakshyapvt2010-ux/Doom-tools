# Security guide

All authorization is enforced by runtime code outside the model. Tool descriptions and
prompts are not security boundaries (PRD 9).

## Trust modes (PRD 9.3)

| Mode | Available | Guarantee |
| --- | --- | --- |
| trusted-host | yes (macOS/Linux, explicit opt-in) | Commands run with **host privileges and no containment**. Approval-gated by default. NOT a sandbox. |
| restricted-local | yes | Runtime-mediated tools only (filesystem, Git, HTTP later). Workspace confinement and policy are enforced by the runtime. Does not apply to shell. |
| sandboxed-local | no (P1) | Container backend; fails closed when requested. |
| remote-sandbox | no (future) | — |

`agentic-tools doctor` reports exactly which modes your platform provides, in these words.

## What is enforced, and where

- **Workspace isolation (FR-007).** Filesystem and Git paths are canonicalized through
  their nearest existing ancestor (symlink-aware) and must stay inside the policy
  workspace. Checked twice: in the tool and in the policy engine (capability paths are
  canonicalized between classification and policy evaluation). Known limit: path checks
  are subject to time-of-check/time-of-use races - an attacker who can rename or swap a
  symlink between the check and the access on a shared host can defeat them. This is
  inherent to host filesystems; the container backend (P1) is the answer for hostile
  workloads.
- **Shell (PRD 9.1).** trusted-host only. No allowlist/"restricted" mode is offered:
  subcommands, flags and wrapper programs bypass them. Unmatched commands classify
  destructive/high and are approval-gated; you may register *named commands* with a
  narrower honest classification. Named-command matching is exact and structural: the
  string must be ONE simple invocation (no `;`, `&&`, `|`, `>`, `$`, backticks, escapes
  or subshells) of that exact bare executable. `ls /tmp; rm -rf x` never inherits the
  classification of `ls`. They are an audit convenience, not a boundary.
- **Shell environment.** The child process receives a minimal allowlisted environment
  (PATH, HOME, TMPDIR/TEMP/TMP, LANG/LC_*, TERM, USER/LOGNAME, SHELL), not the host
  `process.env`, so undeclared secrets in the host environment do not flow into
  model-executed commands. Widen only via `envAllowlist`/`env` (explicit opt-in).
- **Timeouts and cancellation (FR-008).** The runtime enforces the invocation deadline
  on the RETURN: it stops waiting and reports `timeout` even when a tool ignores
  `ctx.signal`. Honest limit: work a non-cooperative tool already started on the host
  may continue; the runtime cannot forcibly stop it. Cooperative tools honor the signal
  (bash kills its whole process group). Regular-expression scans (`filesystem.grep`)
  run in an isolated worker thread that is terminated at the deadline, so a
  catastrophic pattern cannot block the event loop or defeat the timeout.
- **Network egress.** deny-by-default for runtime-mediated tools and sandboxed backends.
  It **cannot** be enforced for host-mode shell; the CLI warns when such a configuration
  is loaded.
- **Capabilities (PRD 9.2).** Classification produces per-invocation capability requests
  (`filesystem.write` bound to a resolved path, `network.http` bound to a host). Policy
  grants can be constrained to paths and hosts. Unknown capabilities fail closed.
- **Approvals (PRD 9.5).** See docs/approvals.md.
- **Redaction.** Registered secret values and common token shapes are replaced with
  `[REDACTED]` in stdout, stderr, errors, traces and audit. Best-effort: encoded,
  transformed or split values can evade it. Keep secrets out of tool-accessible
  environments in the first place.
- **Audit (FR-010).** invocation start, policy decision, approval request/decision and
  invocation end, correlated by trace ID, without payloads by default.

## Git host-process limits

Git checks its actual repository root before each command, so an enclosing repository
outside the workspace is denied. The child environment does not inherit `GIT_DIR`,
`GIT_WORK_TREE` or arbitrary secret-bearing variables. Hooks, signing, pagers and
filesystem monitors are disabled; diff disables external diff/textconv commands.
These choices intentionally differ from interactive Git and produce unsigned commits.
Native Git, repository configuration, filter drivers and host filesystems are still not
isolated. Use trusted repositories. A container backend is required for hostile code.

Caller cancellation is forwarded to Git's child process. See [observability.md](observability.md)
for pending-approval cancellation, trace/metric retention and optional audit-sink failure behavior.


## Prompt injection

A runtime cannot solve prompt injection. This product limits blast radius: policy is
enforced outside the model, and the adversarial suite includes fixtures whose tool output
tries to alter policy or unlock shell access. They fail. Treat all web pages, files and
tool outputs as untrusted data.

## Adversarial suite (FR-023)

`packages/adversarial` covers path traversal, symlink escape, injection against
runtime-mediated tools, prompt-injection fixtures, secret canaries across
stdout/stderr/errors/traces, approval-bypass attempts through every adapter, and
cancellation cleanup. It runs in CI (`pnpm test`) and gates releases.

## Exact-input approval snapshots

The runtime copies and deeply freezes plain JSON-compatible input before schema
validation, classification or approval. Changing the caller's original object
while a human decision is pending cannot change the executed command or resource.
Tools receive that frozen copy. Cycles, accessors, non-finite numbers, functions,
BigInt and non-plain objects are rejected with `validation`, before any approval
or execution. This tightens the same-process API to the JSON tool contract;
convert dates/classes to ordinary JSON data in host code first.

## Deferred approval tickets

`invoke(name, input, {deferApproval: true})` returns `approval_required` before
calling approvers. An unavailable non-interactive approver also leaves a ticket.
The host can inspect `listDeferredApprovals()` and call
`resumeApproval(requestId, {outcome: "allow" | "deny"}, {name, input})`. This is a
trusted host API, never a tool to expose to the model.

Tickets expire after the runtime request's five-minute lifetime, are single-use,
and retain a hash plus redacted preview, not the original input payload. The
process-local store holds at most 256 tickets, evicting the oldest. Restarting
the process loses them. `discardDeferredApproval(id)` cancels a ticket without
execution. There is no persistence or cross-process decision queue implied.

Resume requires the same canonical tool and JSON input, rechecks classification,
version, selection and current policy, and forces `once` scope. A denied request
cannot run even if policy was relaxed in the meantime. Changed input, policy,
classification, expiry, a consumed ID or caller cancellation never executes.
Changing a failed resume's parameters consumes the ticket and requires a fresh
approval. Toolkit instances and their ticket stores must be scoped to the
appropriate trusted host user/session; they do not authenticate host callers.
