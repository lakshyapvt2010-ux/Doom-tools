# Browser tools (`@agentic-tools/browser`)

PRD section 13 browser row (P2): `browser.navigate`, `browser.dom`, `browser.click`, `browser.type`, `browser.screenshot`. A zero-dependency CDP driver launches the system `google-chrome` headless (override with `chromePath` or `AGENTIC_TOOLS_CHROME`); no Playwright/Puppeteer download.

- Every call needs the explicit `browser.control` capability grant (`policy.capabilities`), fails closed without it. Tools are `external`; click/type are high risk, so approvals apply by default.
- Only http(s) pages. file:, chrome:, data: and other schemes are rejected. Private and loopback destinations are refused by default (DNS checked before navigation); a host opts in with `allowPrivateNetwork` for testing.
- `browser.dom` returns bounded text plus capped lists of links, headings, inputs and buttons. Screenshots are capped at 5 MiB. All output is labeled untrusted.
- `browser()` returns the tool array with a `.close()` that shuts Chrome down; call it when the toolkit is retired (the child is also killed on process exit).

Honest limits: click/type use synthetic DOM events, not the trusted input pipeline; sites that ignore them need a fuller driver later. Chrome re-resolves DNS when connecting, so a DNS-rebinding gap remains for navigation (unlike web.fetch). One shared tab per browser() instance: no multi-tab, no downloads/uploads, no form auto-submit, no cookie persistence between instances. Needs a Chrome binary at runtime; CI images (ubuntu/macos) provide one.
