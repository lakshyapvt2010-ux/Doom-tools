# P0/P1 acceptance audit, November 23, 2026

Scope: original PRD v0.2 sections 14-18 and 22. Implementation, execution
validation and product/release approval are different gates. A passing local
script is not an external developer trial. P2/P3 are not release-completion
requirements for this pass.

| Requirement | Current evidence | Remaining check |
| --- | --- | --- |
| FR001 canonical definition | Typed core; registry validates metadata and schemas | Security/release review |
| FR002 input validation | Ajv before execution; invalid-input tests | Cross-platform current-source regression |
| FR003 registry | Name/version discovery, exact resolution and SemVer precedence tests; opaque imported versions retained | No new feature gate identified |
| FR004 context | Scoped services, trace, abort/deadline tests | No new feature gate identified |
| FR005 policy | Runtime authorization, constrained paths/hosts, deny tests | Independent review; container acceptance separate |
| FR006 approval | Exact-input snapshots, expiring single-use tickets, callback/CLI/file queue and MCP/native bridges | Named desktop client verification; multi-user durable services are not shipped |
| FR007 workspace | Traversal, symlink, dangling link and enclosing-Git-root tests | Native Windows acceptance passed; host TOCTOU limit remains disclosed |
| FR008 bounds | Runtime timeouts/output caps, Bash tree kill, Git abort, cleanup regressions | Real Docker timeout/cancel/cleanup passed in run17; independent review |
| FR009 envelopes | Stable results/error codes, generic unknown-exception diagnostics | Provider diagnostics review remains advisable |
| FR010 audit | Correlated start/policy/approval/end events; redaction/canary tests | Independent review; optional sink failure is disclosed |
| FR011 adapter parity (P1) | Real SDK contract tests; local scripted-model/native approval loops | Hosted model quality not measured; other SDK majors unclaimed |
| FR012 MCP server | stdio plus HTTP SDK tests, selection/approval/redaction | Named desktop client certification |
| FR013 authoring | Literal-schema inference, manual generics, Zod converter helper, test helpers/template | External developer first-use gate |
| FR014 mock/replay (P1) | Recording/replay tests without real tool execution | No new feature gate identified |
| FR015 observability | Bounded traces/metrics, redacted audit payload opt-in, defensive trace snapshots | Retention is local/bounded, not durable external storage |
| FR016 CLI | Configuration, footprint listing, doctor, MCP launch tests | Native current-source cross-platform regression |
| FR017 modular install | Packed core/security/runtime installed and compiled outside workspace links | MIT npm alpha published; provenance review remains |
| FR018 platform detection | Linux/macOS modes reported honestly; limited real Docker acceptance | Broader Windows support and independent review |
| FR019 selection | Package/operation/run/server narrowing and guessed-call denial tests | No new feature gate identified |
| FR020 classification | Malformed/throwing/undeclared capabilities restore static bounds | Independent security review |
| FR021 external MCP (P1) | Real stdio/HTTP connections, untrusted labels, capability/approval gates | Named external services not certified |
| FR022 shaping | Payload/result/MCP representation caps, deterministic truncation and cursor tests | JSON-RPC/HTTP/provider-owned framing remains outside caps |
| FR023 adversarial | 27-test package; all passed in remote run11 and current local matrix | Current-source remote verification; independent review |
| P1 Docker | Opt-in separate factory, six executable-double tests, real acceptance script | Real-container acceptance passed in run17; no isolation certification |
| P1 Windows filesystem/Git | Native separators/null-device/environment preparation, native acceptance script | Native Windows acceptance passed in run17; other tools unclaimed |
| P1 web/data/framework breadth | HTTP fetch/request, search interface, SQLite/PostgreSQL reads and framework adapters | Search vendor intentionally unselected; hosted providers not invoked |
| Performance baseline | Warm sequential echo dispatch measured on Linux Node22/24/26 | Repeat across representative hosts before setting budgets |
| Section18 usability | Independent packed strict consumer succeeds | External primary-persona developer must try it unaided |
| Section20 demand | Competitive desk review exists | 5-10 developer conversations and owner go/no-go |
| Section22 release | Known limits and tests documented | MIT alpha published; support policy, independent review and provenance remain |

## Verified source CI, November 23, 2026

[Run 17](https://github.com/MRIARC-08/tch-/actions/runs/45189379629) at `0782a88` passed all eight jobs:
- Ubuntu and macOS, each on Node 22/24/26: build, strict typecheck and test suites.
- Native Windows Node 22.23.5: build/typecheck and dedicated filesystem/Git
  acceptance covering reads/writes, absolute/relative paths, commit/branch/switch,
  traversal/junction denial, search and cancellation. This is not the full
  Linux/macOS suite and does not certify other tools on Windows.
- Real Linux Docker acceptance: workspace write, non-root user, read-only root,
  no host path/socket exposure, no external interface, bounded filesystem,
  timeout/cancellation and no remaining containers.

Earlier Windows runs failed closed on equivalent short/long path aliases.
Native realpath canonicalization fixed the mismatch without bypassing the
workspace boundary. Remote Git runner bytes match the reviewed local source.
PostgreSQL server coverage remains from the earlier local throwaway-cluster
runs, not the remote matrix. Latest local rerun: 285 pass, 2 PostgreSQL skips;
the earlier three-version local checkpoint had 287 pass and zero skips.
No hosted model, independent security review or external developer trial is
claimed. Docker passing checks are not proof of an escape-free sandbox.
The published `@mriarc/tch-tools@0.1.0-alpha.2` is unchanged; these later source
fixes and CI checks have not been republished to npm.

## Remaining completion path

Independent security review, external first-use evidence, developer demand
conversations and owner product decisions remain open. Do not substitute more
code for another person's required evidence. Further release/publication or
spending needs its own authority.

Browser automation, OS-native isolation, remote workers and the broad catalogue
remain P2/P3. Their existence or incompleteness does not redefine the P0/P1 bar.
