// Declares the parsed shape of a qmd item file: loose text and items, each holding its exact source bytes.
// CONTRACT: documents/contracts/qmd-items.md#items
import type { ParsedAnchor } from "./itemAnchor.js";

export const ITEM_CLASS = "labshelf-item";

/** Text outside any item, byte for byte. */
export interface LooseSegment {
  readonly kind: "loose";
  readonly text: string;
}

/**
 * One item. `fence`, `body` and `close` are the exact source bytes, line endings included, and are what gets written;
 * the other fields are read from `fence`.
 */
export interface ItemSegment {
  readonly kind: "item";
  readonly id: string;
  readonly anchor: ParsedAnchor;
  readonly author?: string;
  readonly created?: string;
  /** Every class of the opening line, `labshelf-item` included, in source order. */
  readonly classes: readonly string[];
  /** Every key-value attribute of the opening line in source order, known and unknown. */
  readonly attrs: readonly (readonly [string, string])[];
  readonly fence: string;
  readonly body: string;
  readonly close: string;
}

export type Segment = LooseSegment | ItemSegment;

/** INVARIANT: no two loose segments are adjacent and no loose segment is empty. */
export interface ItemFile {
  readonly segments: readonly Segment[];
}
