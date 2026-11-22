# PostgreSQL read (`@agentic-tools/postgres`)

PRD section 13 (P1: "Database read operations for SQLite and PostgreSQL; mutations remain separately permissioned"). One operation, `postgres.query`.

- Needs an explicit policy grant: `policy.capabilities: { "database.read": true }`. Without it every call fails `permission_denied`.
- The host configures the connection at factory time (connection string or host/port/database/user/password). Credentials never enter tool input or model context. There is no tool input that can retarget the server.
- Accepts one SELECT, WITH or VALUES statement with positional `$1, $2, ...` parameters (string, number, boolean, null). Write keywords, PRAGMA-class commands and multiple statements are rejected by the shared SQL guard (the same one as `sqlite.query`); keywords inside string literals and comments are ignored by the guard.
- Defense in depth on the server side: the session is opened with `default_transaction_read_only=on`, so a write that somehow slipped past the guard fails inside PostgreSQL. `statement_timeout` bounds execution (default 15s).
- Rows are capped (default 100, max 1000) via a `LIMIT` wrapper, text cells are truncated, `bytea` and `bigint` are summarized. Output is labeled untrusted.

Limits: a query can read anything the configured role can see, so connect with a least-privilege read role. The guard is a first line, the read-only session is the real write barrier, but neither limits *what* can be read. An expensive query can burn CPU until the statement timeout fires. Database contents can carry prompt injection. No mutations, no LISTEN/NOTIFY, no COPY, no other database engines.

The test suite spins up a throwaway PostgreSQL cluster from system binaries (`initdb`/`pg_ctl`) and skips with a reason when they are absent; point `AGENTIC_PG_BIN` at a bin directory to use a non-standard install.

Follow-up hardening: each query now runs inside an explicit `BEGIN READ ONLY`
transaction in addition to the connection default. Tests call a stored function
that attempts INSERT (server rejects it), reject a transaction-read-only
downgrade, and verify the actual row cap. Caller abort closes the connection and
listeners are removed. A read-only transaction is not a function sandbox:
privileged PostgreSQL functions can have non-table side effects or access files
and networks. The host must restrict function execution and use a non-superuser,
least-privilege role. Do not connect arbitrary agent queries as a superuser.
