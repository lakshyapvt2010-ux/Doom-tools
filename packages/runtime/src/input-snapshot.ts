/** Copy and freeze plain JSON input so approval cannot race caller mutation. */
export function snapshotInput(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (typeof value !== "object" || !value) throw new Error("Not JSON-compatible");
  if (ancestors.has(value)) throw new Error("Cyclic input");
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Not plain JSON");
  ancestors.add(value);
  try {
    const copy: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) throw new Error("Input accessors are unsupported");
      Object.defineProperty(copy, key, {value: snapshotInput(descriptor.value, ancestors), enumerable: true});
    }
    return Object.freeze(copy);
  } finally { ancestors.delete(value); }
}
