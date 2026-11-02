// Turns an edit of one item of a notes file (a new body, or a new item) into the smallest text replacement of the file, for hosts whose source of truth is a text document.
// CONTRACT: documents/contracts/qmd-items.md#items
import { addItem, parseItemFile, serializeItemFile, setItemBody, type ItemFile } from "./item/index.js";

/** Replace `text[start, end)` with `insert`; offsets are UTF-16 code units of the file text. */
export interface NoteFileReplacement { readonly start: number; readonly end: number; readonly insert: string }

/** The one replacement that turns `before` into `after`: the span between their common prefix and suffix; undefined when they are equal. */
export function diffNoteFileText(before: string, after: string): NoteFileReplacement | undefined {
  if (before === after) return undefined;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let tail = 0;
  while (tail < max - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
  return { start, end: before.length - tail, insert: after.slice(start, after.length - tail) };
}

function replacementOf(text: string, change: (file: ItemFile) => ItemFile): NoteFileReplacement | undefined {
  return diffNoteFileText(text, serializeItemFile(change(parseItemFile(text))));
}

/**
 * The replacement that sets the body of item `id` in the notes file `text`, through the item writer rules (the file's line ending, a final line break),
 * so the fences, the other items and the loose text keep their bytes. Undefined when the body is already the stored one.
 * Throws as `setItemBody` does: no item or several with the id, or a body that would end the item early or change how the rest of the file reads.
 */
export function noteItemBodyEdit(text: string, id: string, body: string): NoteFileReplacement | undefined {
  return replacementOf(text, (file) => setItemBody(file, id, body));
}

/** The replacement that appends a new item `id` with `body`, stamped `created`, after the file's last item and loose text. Throws as `addItem` does. */
export function noteItemAddEdit(text: string, item: { id: string; body: string; created: string; author?: string }): NoteFileReplacement | undefined {
  return replacementOf(text, (file) => addItem(file, item));
}
