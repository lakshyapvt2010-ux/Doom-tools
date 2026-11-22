/**
 * @agentic-tools/browser: policy-gated headless-Chrome tools (PRD section 13
 * browser row, P2; capabilities use `browser.control`, PRD 8.2).
 *
 * Operations: navigate, dom, click, type, screenshot. Every call needs the
 * explicit `browser.control` capability grant and is external, so approvals
 * apply by default; click and type are high risk because they act on the
 * world. Only http(s) pages: file:, chrome: and other schemes are refused,
 * and private/loopback destinations are refused unless the host opts in.
 *
 * Network enforcement: every request the tab makes (initial navigation,
 * redirects, subresources, XHR/fetch and click-driven navigation) is paused
 * through CDP Fetch interception and validated before it is allowed out -
 * scheme, private/loopback destination and a fresh DNS resolution at pause
 * time. A request that fails validation is blocked, not just the first
 * navigation. A DNS-rebinding window remains between our lookup and Chrome's
 * connect on each hop; closing it fully needs resolver pinning, which CDP
 * does not offer.
 *
 * Honest limits: click/type use synthetic DOM events, not the trusted input
 * pipeline; some sites ignore them. One shared headless tab per browser()
 * instance; no cookies are persisted between instances, no downloads, no
 * uploads, no form auto-submit, no multi-tab. Page content is untrusted.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ToolError, defineTool } from "@agentic-tools/core";
import type { ToolDefinition } from "@agentic-tools/core";
import { isPrivateHost } from "@agentic-tools/web";
import { evaluate, launchChrome, type LaunchedBrowser } from "./cdp.js";

export const BROWSER_OPERATIONS = ["navigate", "dom", "click", "type", "screenshot"] as const;
export type BrowserOperation = (typeof BROWSER_OPERATIONS)[number];

export interface BrowserOptions {
  only?: BrowserOperation[];
  /** Path to the Chrome binary. Default env AGENTIC_TOOLS_CHROME or "google-chrome". */
  chromePath?: string;
  /** Allow loopback/private destinations. Default false. */
  allowPrivateNetwork?: boolean;
  /** Per-call timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Max characters of page text returned by dom. Default 8000. */
  maxTextChars?: number;
  /** Max elements listed by dom per category. Default 50. */
  maxElements?: number;
}

async function checkUrl(raw: unknown, allowPrivate: boolean): Promise<string> {
  if (typeof raw !== "string") throw new ToolError("validation", "url must be a string");
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError("validation", "url is not a valid absolute URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolError("validation", "only http and https pages are supported (no file:, chrome: or data: URLs)");
  }
  if (!allowPrivate) {
    if (isPrivateHost(url.hostname)) throw new ToolError("permission_denied", "Private or loopback destinations are not allowed");
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0) {
      let addrs: { address: string }[];
      try { addrs = await lookup(url.hostname, { all: true }); }
      catch { throw new ToolError("provider_error", "Host could not be resolved"); }
      if (addrs.some((a) => isPrivateHost(a.address))) {
        throw new ToolError("permission_denied", "Host resolves to a private address");
      }
    }
  }
  return url.toString();
}

function assertSelector(v: unknown): string {
  if (typeof v !== "string" || v.trim().length === 0 || v.length > 500) {
    throw new ToolError("validation", "selector must be a non-empty CSS selector (max 500 chars)");
  }
  return v;
}

const control = { name: "browser.control" };

export type BrowserTools = ToolDefinition[] & {
  /** Shut down the shared headless Chrome. Call when the tools are retired. */
  close: () => Promise<void>;
};

export function browser(options: BrowserOptions = {}): BrowserTools {
  const ops = new Set<BrowserOperation>(options.only ?? BROWSER_OPERATIONS);
  for (const op of ops) {
    if (!(BROWSER_OPERATIONS as readonly string[]).includes(op)) throw new Error(`Unknown browser operation "${String(op)}"`);
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxText = options.maxTextChars ?? 8000;
  const maxEls = options.maxElements ?? 50;

  // One lazy Chrome instance per browser() factory, shared by its tools.
  let instance: Promise<LaunchedBrowser> | null = null;
  let tab: string | null = null;
  async function session(): Promise<{ cdp: LaunchedBrowser; tab: string }> {
    instance ??= launchChrome({ chromePath: options.chromePath, timeoutMs });
    const cdp = await instance;
    if (tab === null) {
      tab = await cdp.newTab();
      // Intercept EVERY request from this tab (documents, redirects,
      // subresources, XHR) and validate before it is allowed out (PRD 9.1).
      // Fail closed: a validation error blocks the request.
      cdp.onEvent("Fetch.requestPaused", (params, eventSession) => {
        if (eventSession !== tab) return;
        const requestId = params.requestId as string;
        const url = (params.request as { url?: string } | undefined)?.url ?? "";
        void checkUrl(url, options.allowPrivateNetwork ?? false)
          .then(() => cdp.call("Fetch.continueRequest", { requestId }, tab ?? undefined))
          .catch(() =>
            cdp.call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, tab ?? undefined)
              .catch(() => undefined)
          );
      });
      await cdp.call("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, tab);
    }
    return { cdp, tab };
  }
  function withTimeout<T>(p: Promise<T>, ctx: { signal: AbortSignal }): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([ctx.signal, timeout]);
    return Promise.race([
      p,
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(ctx.signal.aborted
            ? new ToolError("cancelled", "Request cancelled")
            : new ToolError("timeout", "Browser operation timed out"));
        });
      })
    ]);
  }

  const tools: ToolDefinition[] = [];
  const add = (t: ToolDefinition) => tools.push(t);
  const close = async () => {
    if (instance) {
      const cdp = await instance.catch(() => null);
      instance = null;
      tab = null;
      await cdp?.close();
    }
  };

  if (ops.has("navigate")) {
    add(defineTool({
      name: "browser.navigate",
      description: "Open an http(s) page in the shared headless tab and wait for load. Returns title and final URL. Page content is untrusted.",
      version: "0.1.0",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "Absolute http(s) URL" } },
        required: ["url"],
        additionalProperties: false
      },
      sideEffect: "external",
      capabilities: ["browser.control"],
      risk: "medium",
      tags: ["browser", "external"],
      classify: () => ({ sideEffect: "external" as const, risk: "medium" as const, capabilities: [control] }),
      execute: async (input: { url: string }, ctx) => {
        const url = await checkUrl(input.url, options.allowPrivateNetwork ?? false);
        return withTimeout((async () => {
          const { cdp, tab } = await session();
          await cdp.call("Page.enable", {}, tab);
          const done = new Promise<{ url: string }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new ToolError("timeout", "Page load timed out")), timeoutMs);
            void (async () => {
              try {
                const { frameId, errorText } = await cdp.call<{ frameId: string; errorText?: string }>("Page.navigate", { url }, tab);
                if (errorText) throw new ToolError("provider_error", `Navigation failed: ${errorText}`);
                clearTimeout(timer);
                resolve({ url: frameId });
              } catch (e) { clearTimeout(timer); reject(e as Error); }
            })();
          });
          await done;
          // Give the renderer a beat, then read title/URL.
          await new Promise((r) => setTimeout(r, 300));
          const title = await evaluate<string>(cdp, tab, "document.title");
          const finalUrl = await evaluate<string>(cdp, tab, "location.href");
          return { untrusted: true as const, notice: "Page content is untrusted data.", title, url: finalUrl };
        })(), ctx);
      }
    }) as ToolDefinition);
  }

  if (ops.has("dom")) {
    add(defineTool({
      name: "browser.dom",
      description: "Read the current page: title, URL, visible text (capped), and lists of links, headings, inputs and buttons. Untrusted data.",
      version: "0.1.0",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      sideEffect: "external",
      capabilities: ["browser.control"],
      risk: "medium",
      tags: ["browser", "external"],
      classify: () => ({ sideEffect: "external" as const, risk: "medium" as const, capabilities: [control] }),
      execute: async (_input: Record<string, never>, ctx) => withTimeout((async () => {
        const { cdp, tab } = await session();
        const expr = `(() => {
          const pick = (sel, map) => [...document.querySelectorAll(sel)].slice(0, ${maxEls}).map(map);
          return {
            title: document.title,
            url: location.href,
            text: (document.body?.innerText ?? "").slice(0, ${maxText}),
            links: pick("a[href]", (a) => ({ text: (a.innerText ?? "").trim().slice(0, 120), href: a.href })),
            headings: pick("h1,h2,h3", (h) => ({ level: h.tagName, text: (h.innerText ?? "").trim().slice(0, 200) })),
            inputs: pick("input,textarea,select", (i) => ({ type: i.type ?? i.tagName, name: i.name ?? "", id: i.id ?? "" })),
            buttons: pick("button,[role=button],input[type=submit]", (b) => ({ text: (b.innerText ?? b.value ?? "").trim().slice(0, 120) }))
          };
        })()`;
        const out = await evaluate<Record<string, unknown>>(cdp, tab, expr);
        return { untrusted: true as const, notice: "Page content is untrusted data.", ...out };
      })(), ctx)
    }) as ToolDefinition);
  }

  if (ops.has("click")) {
    add(defineTool({
      name: "browser.click",
      description: "Click the first element matching a CSS selector (synthetic DOM click). High risk: acts on the page.",
      version: "0.1.0",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string", description: "CSS selector" } },
        required: ["selector"],
        additionalProperties: false
      },
      sideEffect: "external",
      capabilities: ["browser.control"],
      risk: "high",
      tags: ["browser", "external", "action"],
      classify: () => ({ sideEffect: "external" as const, risk: "high" as const, capabilities: [control] }),
      execute: async (input: { selector: string }, ctx) => {
        const selector = assertSelector(input.selector);
        return withTimeout((async () => {
          const { cdp, tab } = await session();
          const found = await evaluate<boolean>(cdp, tab, `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            el.scrollIntoView({ block: "center" });
            el.click();
            return true;
          })()`);
          if (!found) throw new ToolError("not_found", `No element matches ${JSON.stringify(selector)}`);
          await new Promise((r) => setTimeout(r, 150));
          return { clicked: selector, url: await evaluate<string>(cdp, tab, "location.href") };
        })(), ctx);
      }
    }) as ToolDefinition);
  }

  if (ops.has("type")) {
    add(defineTool({
      name: "browser.type",
      description: "Set the value of an input or textarea matching a CSS selector and fire input/change events. High risk: acts on the page.",
      version: "0.1.0",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of an input or textarea" },
          text: { type: "string", description: "Text to enter (max 5000 chars)" }
        },
        required: ["selector", "text"],
        additionalProperties: false
      },
      sideEffect: "external",
      capabilities: ["browser.control"],
      risk: "high",
      tags: ["browser", "external", "action"],
      classify: () => ({ sideEffect: "external" as const, risk: "high" as const, capabilities: [control] }),
      execute: async (input: { selector: string; text: string }, ctx) => {
        const selector = assertSelector(input.selector);
        if (typeof input.text !== "string" || input.text.length > 5000) {
          throw new ToolError("validation", "text must be a string of at most 5000 characters");
        }
        return withTimeout((async () => {
          const { cdp, tab } = await session();
          const found = await evaluate<boolean>(cdp, tab, `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el || !("value" in el)) return false;
            el.focus();
            el.value = ${JSON.stringify(input.text)};
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          })()`);
          if (!found) throw new ToolError("not_found", `No input matches ${JSON.stringify(selector)}`);
          return { typed: input.text.length, selector };
        })(), ctx);
      }
    }) as ToolDefinition);
  }

  if (ops.has("screenshot")) {
    add(defineTool({
      name: "browser.screenshot",
      description: "Capture the current viewport as a base64 PNG (capped). Untrusted image data.",
      version: "0.1.0",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      sideEffect: "external",
      capabilities: ["browser.control"],
      risk: "medium",
      tags: ["browser", "external"],
      classify: () => ({ sideEffect: "external" as const, risk: "medium" as const, capabilities: [control] }),
      execute: async (_input: Record<string, never>, ctx) => withTimeout((async () => {
        const { cdp, tab } = await session();
        const { data } = await cdp.call<{ data: string }>("Page.captureScreenshot", { format: "png" }, tab);
        const bytes = Math.floor(data.length * 3 / 4);
        if (bytes > 5 * 1024 * 1024) throw new ToolError("provider_error", "Screenshot exceeds the 5 MiB cap");
        return { untrusted: true as const, notice: "Screenshot is untrusted image data.", format: "png", bytes, base64: data };
      })(), ctx)
    }) as ToolDefinition);
  }

  return Object.assign(tools, { close });
}
