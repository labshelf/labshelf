// Places a comment thread in its file's current text, or reports it detached.
// CONTRACT: documents/contracts/collaboration.md#comments
import type { Text } from "yjs";
import { liveRange, type TextRange } from "./commentAnchor.js";
import type { CommentThread } from "./commentThread.js";
import { exactMatch, fuzzyMatch } from "./quoteMatch.js";

/**
 * Relative positions win when they span text, even edited text; then the exact quote, then an approximate one.
 * @param yText the file doc's text in a shared project, whose content is `text`
 */
export function locateThread(thread: CommentThread, text: string, yText?: Text): TextRange | "detached" {
  const live = yText ? liveRange(yText, thread.anchor) : undefined;
  return live ?? exactMatch(text, thread.anchor) ?? fuzzyMatch(text, thread.anchor) ?? "detached";
}
