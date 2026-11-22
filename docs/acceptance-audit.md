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
| FR007 workspace | Traversal, symlink, dangling link and enclosing-Git-root tests | Native Windows checks; host TOCTOU limit remains disclosed |
| FR008 bounds | Runtime timeouts/output caps, Bash tree kill, Git abort, cleanup regressions | Real Docker timeout/cancel/cleanup checks |
| FR009 envelopes | Stable results/error codes, generic unknown-exception diagnostics | Provider diagnostics review remains advisable |
| FR010 audit | Correlated start/policy/approval/end events; redaction/canary tests | Independent review; optional sink failure is disclosed |
| FR011 adapter parity (P1) | Real SDK contract tests; local scripted-model/native approval loops | Hosted model quality not measured; other SDK majors unclaimed |
| FR012 MCP server | stdio plus HTTP SDK tests, selection/approval/redaction | Named desktop client certification |
| FR013 authoring | Literal-schema inference, manual generics, Zod converter helper, test helpers/template | External developer first-use gate |
| FR014 mock/replay (P1) | Recording/replay tests without real tool execution | No new feature gate identified |
| FR015 observability | Bounded traces/metrics, redacted audit payload opt-in, defensive trace snapshots | Retention is local/bounded, not durable external storage |
| FR016 CLI | Configuration, footprint listing, doctor, MCP launch tests | Native current-source cross-platform regression |
| FR017 modular install | Packed core/security/runtime installed and compiled outside workspace links | Publication/provenance not performed |
| FR018 platform detection | Linux/macOS modes reported honestly; sandbox unavailable pending validation | Windows phased support and actual Docker checks |
| FR019 selection | Package/operation/run/server narrowing and guessed-call denial tests | No new feature gate identified |
| FR020 classification | Malformed/throwing/undeclared capabilities restore static bounds | Independent security review |
| FR021 external MCP (P1) | Real stdio/HTTP connections, untrusted labels, capability/approval gates | Named external services not certified |
| FR022 shaping | Payload/result/MCP representation caps, deterministic truncation and cursor tests | JSON-RPC/HTTP/provider-owned framing remains outside caps |
| FR023 adversarial | 27-test package; all passed in remote run11 and current local matrix | Current-source remote verification; independent review |
| P1 Docker | Opt-in separate factory, six executable-double tests, real acceptance script | Real container start blocked locally by cgroups, no isolation certification |
| P1 Windows filesystem/Git | Native separators/null-device/environment preparation, native acceptance script | Actual Windows runner result |
| P1 web/data/framework breadth | HTTP fetch/request, search interface, SQLite/PostgreSQL reads and framework adapters | Search vendor intentionally unselected; hosted providers not invoked |
| Performance baseline | Warm sequential echo dispatch measured on Linux Node22/24/26 | Repeat across representative hosts before setting budgets |
| Section18 usability | Independent packed strict consumer succeeds | External primary-persona developer must try it unaided |
| Section20 demand | Competitive desk review exists | 5-10 developer conversations and owner go/no-go |
| Section22 release | Known limits and tests documented | License/naming/support decisions, independent review, provenance, release authorization |

## Verified checkpoints

- Latest local matrix: 286 tests pass on each Linux Node22.23.5/24.22.3/26.13.1,
  zero skips. Real PostgreSQL; Docker checks are executable doubles only.
- Build and strict typecheck pass. Native filesystem/Git smoke passes on the
  same three Linux versions. Independent packed strict consumer passes.
- Remote run11 at 8a1df4a: all six Ubuntu/macOS jobs passed. Each Ubuntu job:
  269 pass/2 skip; each macOS job: 268 pass/3 skip, of 271. PostgreSQL and
  macOS loopback-name skips are not converted to coverage.
  https://github.com/MRIARC-08/tch-/actions/runs/45058558875
- Current local commits are not remotely verified. No new token or workflow
  mutation was used. Included allowance and the existing zero paid cap must be
  checked again before any separately authorized CI extension.

## Finite completion path

1. Run native Docker and Windows acceptance in an authorized environment;
   fix actual failures without weakening isolation or silently skipping them.
2. Verify the current source on the declared Linux/macOS Node matrix, with
   exact skips, and run real database tests where available.
3. Finish independent security, external first-use and owner product/release
   gates. Do not substitute more code for another person's required evidence.

Browser automation, OS-native isolation, remote workers and the broad catalogue
remain P2/P3. Their existence or incompleteness does not redefine the P0/P1 bar.
