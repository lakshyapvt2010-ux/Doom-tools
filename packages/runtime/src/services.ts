/**
 * Scoped service access (PRD 8.3, 11).
 *
 * context.services contains only services the host registered via
 * createToolkit({ services }) AND that the tool declared (static
 * capabilities) and policy granted (classified capabilities). Accessing
 * any other service fails with permission_denied. Tools never receive
 * unrestricted global access by default.
 */

import { ToolError, type CapabilityRequest, type ToolDefinition } from "@agentic-tools/core";

function serviceVisible(
  serviceName: string,
  declared: string[],
  granted: CapabilityRequest[]
): boolean {
  const declaredMatch = declared.some(
    (c) => c === serviceName || c.startsWith(serviceName + ".")
  );
  if (!declaredMatch) return false;
  return granted.some((c) => c.name === serviceName || c.name.startsWith(serviceName + "."));
}

export function scopeServices(
  registered: Record<string, unknown>,
  tool: ToolDefinition,
  grantedCapabilities: CapabilityRequest[]
): Record<string, unknown> {
  const allowed = new Map<string, unknown>();
  for (const [name, service] of Object.entries(registered)) {
    if (serviceVisible(name, tool.capabilities, grantedCapabilities)) {
      allowed.set(name, service);
    }
  }
  return new Proxy<Record<string, unknown>>({}, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (allowed.has(prop)) return allowed.get(prop);
      throw new ToolError(
        "permission_denied",
        `Service "${prop}" is not available to tool "${tool.name}": the tool must declare a "${prop}.*" capability and policy must grant it.`
      );
    },
    has(_target, prop) {
      return typeof prop === "string" && allowed.has(prop);
    },
    ownKeys() {
      return [...allowed.keys()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && allowed.has(prop)) {
        return { enumerable: true, configurable: true, value: allowed.get(prop) };
      }
      return undefined;
    }
  });
}
