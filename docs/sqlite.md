# SQLite read (`@agentic-tools/sqlite`)

PRD section 13 (P1). One operation, `sqlite.query`.

- Needs an explicit policy grant: `policy.capabilities: { "sqlite.read": true }`. Without it every call fails `permission_denied`.
- The database file must be inside the workspace (same confinement as the filesystem tools, including symlink checks). It is opened read-only with `node:sqlite`.
- Accepts one SELECT, WITH or VALUES statement. PRAGMA, ATTACH, DETACH, VACUUM, load_extension, write keywords and multiple statements are rejected. Keywords inside string literals and comments are ignored by the guard. Read-only open mode is the real write barrier; the guard is a first line.
- Positional `?` parameters (string, number, null). Rows capped (default 100, max 1000), text cells truncated, blobs summarized. Output is labeled untrusted.

Limits: `node:sqlite` is experimental in Node 22 and prints an ExperimentalWarning on first use. Queries run synchronously, so an expensive query can block the event loop and the timeout cannot interrupt it. Database contents can carry prompt injection. No write tools, no other database engines.
