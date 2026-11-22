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
