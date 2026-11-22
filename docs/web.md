# Web fetch (`@agentic-tools/web`)

PRD section 13 row 5 (P1). One operation, `web.fetch`: HTTP GET of an `http(s)` URL.

- Each call is classified with the concrete host (`network.http`, `host`), so the runtime network policy decides. The default is deny-by-default; allow hosts with `policy.network = { allowHosts: [...] }`.
- The tool is `external` / `medium`, so it needs approval by default (a URL can carry data out). Set an approval rule for `web.fetch` to relax this deliberately.
- Redirects are not followed. A redirect comes back as data with its target; the next call is classified and checked on its own host.
- Loopback, private, link-local and `.local`/`.internal` destinations are refused even for allowlisted names, unless the host sets `allowPrivateNetwork: true`. Resolved addresses are checked too.
- Bodies are capped (default 256 KiB, max 5 MiB) with an explicit truncation marker; only text-like content types are returned. Output is labeled untrusted.
- URLs with embedded credentials are rejected. No cookies or credentials are sent.

Limits: resolved addresses are validated inside the connection's own DNS lookup, so the address connected to is the address checked (DNS rebinding between check and connect is closed for each hop). Redirect targets are re-checked on the next call. This is not an egress firewall and does not constrain host-mode shell. No proxy support; a configured HTTP proxy would bypass the check, so none is used. No browser automation, search provider or non-GET methods.

## Pluggable search (P1)

`web({ only: ["search"], searchProvider })` exposes `web.search`. No default
provider ships and no API key is needed for the interface tests. The host supplies
`{ host, search(query, { limit, signal }) }`; `search` returns an array of
`{ title, url, snippet?, publishedDate? }` hits. Provider credentials belong in the
host implementation, never model input.

The declared provider host must pass the runtime network allowlist and ordinary
external-action approval. The host is captured at construction. Results are
untrusted, capped at 10 (default 5); titles, snippets, dates and URLs are bounded;
malformed or credential-bearing URLs are dropped. A truncation flag records
omitted results. Returned URLs are not fetched. Search callbacks receive a
combined caller/timeout signal and must honor cancellation.

Important boundary: a provider is trusted host code, not a sandbox. The declared
host classifies policy but cannot constrain arbitrary requests made by a callback.
The provider must implement redirect, destination and credential restrictions
itself, or use a restricted HTTP implementation. The private-network and
connect-time DNS checks of `web.fetch` do NOT automatically apply to callbacks.
The provider response is materialized before shaping, so the callback also owns
its upstream response/memory bound. No real search backend or provider account
has been validated. Choosing a default backend remains PRD open question 6.

## Configurable HTTP client (P1)

`web({ only: ["request"] })` exposes opt-in `web.request`; default `web()` still
exposes GET-only `web.fetch`. The separate P1 HTTP-client requirement is not
satisfied by calling a GET-only fetch client configurable.

Input: `url`, `method` (GET by default; GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS),
optional UTF-8 `body` (64 KiB maximum, not for GET/HEAD) and string `headers`
(30 maximum, each value at most 2048 characters). Common credential headers,
cookies, host and hop-by-hop/transport headers are refused. Do not put secrets
in bodies, query parameters or custom headers; this is not a general secret
scanner. There is no built-in authentication or cookie jar. Authenticated APIs
need a separate host-owned integration that keeps credentials out of model input.

Every request is statically external/high-risk, including GET, and passes the
same runtime host allowlist and approval path. POST/PUT/PATCH/DELETE can change
remote state; exposing this tool is an explicit host choice, never a default.
Connect-time DNS/private-network checks, response bounds and untrusted labeling
are shared with fetch. Redirects, including 307, are returned and never followed
or replayed with a body. Response headers other than content type and redirect
target are not exposed. No proxy support, multipart uploads or binary responses.
Five local fixture tests cover method/body/header forwarding, policy/approval
before network, rejected input, opt-in risk bounds and non-replayed redirects.

IPv6 hardening: the destination helper normalizes IPv6 spellings before testing
IPv4-mapped literals. This closes the dotted-to-hex URL normalization bypass.
Private embedded IPv4 in compatible, standard translation and 6to4 addresses,
IPv6 multicast and site-local ranges are also refused. This is destination
validation, not a host-wide network sandbox or proxy-detection system.
