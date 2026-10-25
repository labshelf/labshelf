// Carries the keys a JSON object has beyond the known ones through a rewrite.
import type { UnknownFields } from "../space.js";

// TRAP: plain assignment of "__proto__" sets the prototype, and `in` sees inherited names such as "toString";
// own-property checks and defineProperty keep those keys as ordinary data.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export function deriveUnknownFields(raw: Record<string, unknown>, known: readonly string[]): UnknownFields {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) { if (!known.includes(key)) { setOwn(out, key, raw[key]); } }
  return out;
}

/** Drops unset known keys, then appends unknown keys; a known key always wins over an unknown one of the same name. */
export function withUnknownFields(known: Record<string, unknown>, extra: UnknownFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(known)) { if (value !== undefined) { setOwn(out, key, value); } }
  for (const [key, value] of Object.entries(extra)) { if (!Object.hasOwn(known, key)) { setOwn(out, key, value); } }
  return out;
}
