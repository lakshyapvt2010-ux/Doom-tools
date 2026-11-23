# Alpha release validation, November 23, 2026

## What actually ran

The alpha tarball was installed by npm in a separate local Git repository,
outside the main monorepo. No workspace aliases or source imports were used.
The independent application passed on Linux Node22.23.5,24.22.3,26.13.1:

- strict TypeScript consumer compile, including inferred custom-tool inputs;
- a repository repair task using the real Vercel AI SDK5.0.292 with scripted
  MockLanguageModelV2 tool calls;
- the same repair task through a real MCP SDK client/server pair;
- read/search a deliberately broken file, run its failing test, edit the bug,
  rerun successfully, stage/commit and verify clean Git state;
- eight successful task calls, five explicit approvals and correlated traces
  per route, plus hidden-tool and traversal denial;
- no-approver failure returning approval_required;
- packaged CLI doctor, configuration validation and tool-footprint listing;
- a separate child-process MCP stdio connection to the packaged CLI, discovery
  and a real file read.

The application source is included in `examples/evaluator-app`. After the npm
release is available, copy that folder outside this package, run `npm install`,
`npm run typecheck`, `npm test` and `npm run test:stdio`. Its source discloses
that model output is scripted. Shell/Git processes are real and uncontained on
the trusted Linux host. No hosted model or provider spending was used.

The current main source also passes 287 tests on Linux Node22 with real
PostgreSQL after the release's Ajv update. Before that patch, the same287-test
suite passed on each Linux Node22/24/26. Earlier remote CI at8a1df4a passed six
Ubuntu/macOS jobs with explicit database/hostname skips. No newer remote or
Windows result is implied. Original detailed history is in VALIDATION.md.

## Dependency audit

A fresh install of the release alone returned zero known npm audit findings in
its production dependency tree on November23. Ajv was updated to8.20.0 after
checking its current advisory. This is a point-in-time registry audit, not an
independent security assessment or proof of no vulnerabilities.

The optional AI SDK5 used by the demonstration has older transitive dependency
advisories. It is not installed by this package and is not used for HTTP/model
network calls in this scripted test. Do not copy that version into a production
hosted-provider app without reviewing/updating its dependency tree. Other SDK
versions are not certified by this test.

## Not verified

Hosted-model quality, every third-party application, the user's machine,
native Windows, Docker/kernel isolation, independent security review,
large-scale concurrency and production operations are not verified. Docker and
browser modules are excluded from this npm artifact. No claim is made that the
whole PRD or future roadmap is complete.
