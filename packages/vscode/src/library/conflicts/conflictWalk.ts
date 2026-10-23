// Walks the conflict copies one by one: asks for a choice and applies it, until the user stops.
import type { ConflictCopy, ConflictResolution } from "@labshelf/core";

export interface ConflictWalkDeps {
  /** Resolves to undefined when the user dismisses the question. */
  ask: (copy: ConflictCopy, index: number, total: number) => Promise<ConflictResolution | "mergeMyself" | undefined>;
  mergeMyself: (copy: ConflictCopy) => Promise<void>;
  apply: (copy: ConflictCopy, resolution: ConflictResolution) => Promise<void>;
  onFailure: (copy: ConflictCopy, error: unknown) => void;
}

/** @returns how many copies are still unresolved: dismissed, skipped after a stop, or failed. */
export async function walkConflicts(copies: ConflictCopy[], deps: ConflictWalkDeps): Promise<number> {
  let remaining = copies.length;
  for (const [index, copy] of copies.entries()) {
    const resolution = await deps.ask(copy, index, copies.length);
    if (!resolution) { break; }
    try {
      if (resolution === "mergeMyself") { await deps.mergeMyself(copy); }
      else { await deps.apply(copy, resolution); remaining -= 1; }
    } catch (error) {
      deps.onFailure(copy, error);
    }
  }
  return remaining;
}
