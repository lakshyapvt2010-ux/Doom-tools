# Independent Agentic Tools application

This is a separate local Git repository. It installs the packed alpha tarball,
not source files or workspace links from the main project. `npm test` uses the
real Vercel AI SDK with a scripted MockLanguageModelV2, and a real connected MCP
SDK client/server pair. No hosted model, API key or paid service is used.

Each route reads and searches a disposable broken repository, runs a failing
test, edits the bug, reruns the test successfully, stages and commits the fix,
and checks a clean tree. It also checks exact approval counts, traces/metrics,
hidden-tool denial and path escape denial. A no-approver case fails closed.
The test uses actual host filesystem, Bash and Git processes on Linux. Those
processes run in trusted-host mode, with no sandbox claim.

Run `npm install`, `npm run typecheck`, `npm test`. Use Node 22, 24 or 26.
The checked-in result is execution evidence for this fixture, not an autonomous
model benchmark or proof that every application supports the package.
