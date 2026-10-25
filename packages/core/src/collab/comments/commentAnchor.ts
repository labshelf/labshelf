// Builds a thread's anchor from a range of text and resolves its Yjs relative positions back to a range.
// CONTRACT: documents/contracts/collaboration.md#comments
import * as Y from "yjs";
import { base64ToBytes, bytesToBase64 } from "../../encoding/index.js";
import type { CommentAnchor } from "./commentThread.js";

const CONTEXT_LENGTH = 32;

/** A range of text, in UTF-16 offsets, `end` exclusive. */
export interface TextRange { start: number; end: number }

export function deriveAnchor(text: string, start: number, end: number): CommentAnchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  };
}

// `start` binds to the character after it and `end` to the one before, so text typed at an edge stays outside.
const encode = (yText: Y.Text, index: number, assoc: number): string =>
  bytesToBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(yText, index, assoc)));

/** The anchor of a range in a shared file's text, with relative positions that follow concurrent edits. */
export function deriveLiveAnchor(yText: Y.Text, start: number, end: number): CommentAnchor {
  return { ...deriveAnchor(yText.toString(), start, end), start: encode(yText, start, 0), end: encode(yText, end, -1) };
}

function decode(yText: Y.Text, encoded: string): number | undefined {
  if (!yText.doc) { return undefined; }
  const position = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(base64ToBytes(encoded)), yText.doc);
  // A position into another type of the doc is not a position in this text.
  return position && position.type === yText ? position.index : undefined;
}

/** @returns undefined when the anchor has no relative positions, they are unreadable, or the range they span is empty */
export function deriveLiveRange(yText: Y.Text, anchor: CommentAnchor): TextRange | undefined {
  if (anchor.start === undefined || anchor.end === undefined) { return undefined; }
  try {
    const start = decode(yText, anchor.start);
    const end = decode(yText, anchor.end);
    return start !== undefined && end !== undefined && start < end ? { start, end } : undefined;
  } catch {
    // TRAP: positions come from peers, so malformed bytes are expected input, not a bug; the quote takes over.
    return undefined;
  }
}
