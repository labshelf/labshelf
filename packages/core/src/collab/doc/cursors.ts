// Encodes a selection in a Y.Text as base64 relative positions that survive concurrent edits, decodes a peer's, and gives each peer a colour.
import * as Y from "yjs";
import { base64ToBytes, bytesToBase64 } from "../../encoding/index.js";
import { HIGHLIGHT_COLORS } from "../../ui/tokens/index.js";

/** Offsets into the Y.Text; `head` is where the caret is. */
export interface TextSelection { anchor: number; head: number }
/** The `anchor` and `head` of a presence state. */
export interface RelativeSelection { anchor: string; head: string }

/** The base64 relative position of `index`; `assoc` -1 binds it to the character before, 0 (the default) to the one after. */
export const encodeRelativePosition = (text: Y.Text, index: number, assoc = 0): string =>
  bytesToBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index, assoc)));

function decode(text: Y.Text, encoded: string): number | null {
  const doc = text.doc;
  if (!doc) { return null; }
  const position = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(base64ToBytes(encoded)), doc);
  // A position into another type of the doc is not a position in this text.
  return position && position.type === text ? position.index : null;
}

export function deriveRelativeSelection(text: Y.Text, selection: TextSelection): RelativeSelection {
  return { anchor: encodeRelativePosition(text, selection.anchor), head: encodeRelativePosition(text, selection.head) };
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

const PEER_COLOURS: readonly string[] = Object.values(HIGHLIGHT_COLORS);

/**
 * The colour a peer announces is kept only when it is one of the palette's, since presence is
 * untrusted input that ends up in editor CSS; any other peer gets the same colour on every
 * screen from its awareness client id.
 */
export function derivePeerColour(announced: string, clientId: number): string {
  return PEER_COLOURS.includes(announced) ? announced : PEER_COLOURS[Math.abs(clientId) % PEER_COLOURS.length]!;
}
