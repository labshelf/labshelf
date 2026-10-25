// Encodes a selection in a Y.Text as base64 relative positions that survive concurrent edits, and decodes a peer's.
import * as Y from "yjs";
import { base64ToBytes, bytesToBase64 } from "../../encoding/index.js";

/** Offsets into the Y.Text; `head` is where the caret is. */
export interface TextSelection { anchor: number; head: number }
/** The `anchor` and `head` of a presence state. */
export interface RelativeSelection { anchor: string; head: string }

const encode = (text: Y.Text, index: number): string =>
  bytesToBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index)));

function decode(text: Y.Text, encoded: string): number | null {
  const doc = text.doc;
  if (!doc) { return null; }
  const position = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(base64ToBytes(encoded)), doc);
  // A position into another type of the doc is not a position in this text.
  return position && position.type === text ? position.index : null;
}

export function deriveRelativeSelection(text: Y.Text, selection: TextSelection): RelativeSelection {
  return { anchor: encode(text, selection.anchor), head: encode(text, selection.head) };
}

/** Null when a peer's positions cannot be read or do not point into `text`: they are untrusted input. */
export function deriveAbsoluteSelection(text: Y.Text, selection: RelativeSelection): TextSelection | null {
  try {
    const anchor = decode(text, selection.anchor);
    const head = decode(text, selection.head);
    return anchor === null || head === null ? null : { anchor, head };
  } catch {
    return null;
  }
}
