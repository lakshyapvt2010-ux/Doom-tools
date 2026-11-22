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
    if (array) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = (value as unknown[]).length;
      // Non-index properties and holes are not part of JSON array data.
      // Retaining them would create input-hash collisions at approval resume.
      if (Object.keys(descriptors).some(key => key !== "length" &&
          (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) throw new Error("Non-JSON array property");
      const copy: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) throw new Error("Sparse or accessor array");
        copy.push(snapshotInput(descriptor.value, ancestors));
      }
      return Object.freeze(copy);
    }
    const copy: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) throw new Error("Input accessors are unsupported");
      Object.defineProperty(copy, key, {value: snapshotInput(descriptor.value, ancestors), enumerable: true});
    }
    return Object.freeze(copy);
  } finally { ancestors.delete(value); }
}
