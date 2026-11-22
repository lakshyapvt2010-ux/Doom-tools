# Tool reference

All tools return the canonical envelope (PRD 8.4). Paths are relative to the toolkit
workspace unless stated. Platforms: macOS and Linux (PRD 14).

## @agentic-tools/filesystem

Default set (read-only): `read`, `list`, `search`, `grep`, `diff`. Opt-in: `write`, `edit`.

| Operation | Input | Output | Side effect / capabilities |
| --- | --- | --- | --- |
| filesystem.read | path, offset?, limit? | content, sizeBytes, byte-window pagination with explicit truncation marker | read / filesystem.read |
| filesystem.list | path?, cursor?, limit? | items (name/type/size), nextCursor | read / filesystem.read |
| filesystem.search | pattern (glob `** * ?`), path?, includeIgnored?, cursor?, limit? | matching paths, nextCursor | read / filesystem.read |
| filesystem.grep | pattern (JS regex), path?, glob?, ignoreCase?, cursor?, limit? | matching lines with file/line, nextCursor | read / filesystem.read |
| filesystem.diff | pathA, pathB | unified diff text, changed | read / filesystem.read |
| filesystem.write | path, content, createParents? | bytesWritten | write / filesystem.write |
| filesystem.edit | path, edits[{find, replace, all?}] | replacements | write / filesystem.write |

`filesystem({ root })` may narrow the boundary below the workspace, never widen it.

## @agentic-tools/git

Default set: `status`, `diff`, `log`, `branches` (list, read-only). Opt-in: `branch` (list or create), `switch`, `add`, `reset`,
`commit`.

| Operation | Notes | Side effect |
| --- | --- | --- |
| git.status | branch + porcelain entries | read |
| git.diff | staged?, ref?, pathspec? | read |
| git.log | limit?, ref? | read |
| git.branches | list local branches and current | read |
| git.branch | list, or `create` (+ startPoint); no deletion | read / write |
| git.switch | branch, create? | write |
| git.add | pathspec[] | write |
| git.reset | unstages pathspec[] only; --hard not offered | write |
| git.commit | message, allowEmpty? | write |

Refs and pathspecs are validated against flag injection; repositories must sit inside the
workspace. `git.branch` classifies per call: listing is read, creating is write.

## @agentic-tools/bash

One operation, `bash.execute { command, cwd?, timeoutMs? }`, in trusted-host mode: host
privileges, no containment, approval-gated by default. `bash({ namedCommands })` lets you
register executables with a narrower honest classification. Matching is exact and
structural: the command string must parse as ONE simple invocation (no `;`, `&&`, `|`,
`>`, `$`, backticks, escapes or subshells) whose first word is exactly the configured
bare executable name, e.g. `{ name: "ls", command: "ls", sideEffect: "read", risk: "low" }`
matches `ls -la /tmp` but NOT `ls /tmp; rm -rf x`, `ls $(cmd)`, `ls > out`, `ls $HOME`,
`FOO=bar ls` or `/bin/ls` - all of those classify destructive/high and are approval-gated.
The child process receives a minimal allowlisted environment (PATH, HOME, TMPDIR, LANG,
TERM, USER, SHELL and close kin), not the host `process.env`; widen it only with
`envAllowlist`/`env` (explicit opt-in, so undeclared host secrets never flow into
model-executed commands). Output is capped per stream with explicit truncation markers;
timeouts kill the whole process group. Working directory is confined to the workspace.
