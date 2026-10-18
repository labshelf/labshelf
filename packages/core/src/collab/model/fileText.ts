/** Reads and edits the text of a shared file's doc with minimal changes. */
import type { Doc, Text } from "yjs";

/** The Y.Text that holds a shared text file's content. */
export const fileText = (doc: Doc): Text => doc.getText("content");

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Turns the doc's text into `next` with one delete and one insert between the common prefix and suffix, in one
 * transaction under `origin`, so concurrent edits elsewhere in the file merge instead of being replaced.
 */
export function replaceFileText(doc: Doc, next: string, origin: unknown): void {
  const text = fileText(doc);
  const current = text.toString();
  if (current === next) { return; }
  const shorter = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < shorter && current.charCodeAt(prefix) === next.charCodeAt(prefix)) { prefix += 1; }
  // TRAP: Yjs turns a half surrogate pair into U+FFFD, so an edit boundary never falls inside one.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) { prefix -= 1; }
  let suffix = 0;
  while (suffix < shorter - prefix && current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) { suffix += 1; }
  if (suffix > 0 && isLowSurrogate(current.charCodeAt(current.length - suffix))) { suffix -= 1; }
  doc.transact(() => {
    const removed = current.length - prefix - suffix;
    if (removed > 0) { text.delete(prefix, removed); }
    const inserted = next.slice(prefix, next.length - suffix);
    if (inserted.length > 0) { text.insert(prefix, inserted); }
  }, origin);
}
