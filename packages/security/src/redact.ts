/**
 * Best-effort secret redaction (PRD 9.1).
 *
 * Redaction reduces but CANNOT eliminate leakage: encoded, transformed or
 * split values can evade it. The primary control is keeping secrets out of
 * tool-accessible environments in the first place; this layer catches
 * known values and common token shapes in stdout, stderr, errors, traces
 * and audit events.
 */

export const REDACTED = "[REDACTED]";

/** Built-in patterns for common secret shapes. */
const BUILTIN_PATTERNS: RegExp[] = [
  // AWS access key id
  /AKIA[0-9A-Z]{16}/g,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  // OpenAI-style keys
  /sk-[A-Za-z0-9_-]{20,}/g,
  // Slack tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  // PEM private key blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // key=value style secrets in text output
  /((?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*["']?)[^\s"']{8,}(["']?)/gi
];

export interface RedactorOptions {
  /** Known secret values. Values shorter than 4 chars are ignored. */
  secrets?: string[];
  /** Additional caller-supplied patterns. */
  patterns?: RegExp[];
}

export interface Redactor {
  redactText(text: string): string;
  /** Deep-redact string values inside arbitrary JSON-like data. */
  redactValue<T>(value: T): T;
}

export function createRedactor(options: RedactorOptions = {}): Redactor {
  const secrets = (options.secrets ?? []).filter((s) => typeof s === "string" && s.length >= 4);
  const patterns = [...BUILTIN_PATTERNS, ...(options.patterns ?? [])];

  function redactText(text: string): string {
    if (!text) return text;
    let out = text;
    for (const secret of secrets) {
      // Literal replacement; split/join avoids regex-escaping concerns.
      out = out.split(secret).join(REDACTED);
    }
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, (whole, p1?: string, p2?: string) => {
        // For key=value patterns keep the key, redact the value.
        if (typeof p1 === "string" && p1 !== "" && /[:=]\s*["']?$/.test(p1)) {
          return `${p1}${REDACTED}${typeof p2 === "string" ? p2 : ""}`;
        }
        return REDACTED;
      });
    }
    return out;
  }

  function redactValue<T>(value: T): T {
    if (typeof value === "string") return redactText(value) as T;
    if (Array.isArray(value)) return value.map((v) => redactValue(v)) as T;
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactValue(v);
      }
      return out as T;
    }
    return value;
  }

  return { redactText, redactValue };
}
