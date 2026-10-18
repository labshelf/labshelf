// Applies a page's edit ranges, all expressed against the same original text, to that text.
import { MAX_EDIT_CHANGES, type TextChange } from "../../helperMessages.js";
import { HelperProjectError } from "./helperProjectError.js";

/** @throws stale when a range is outside the text or ranges overlap; limit past the changes cap */
export function applyTextChanges(text: string, changes: readonly TextChange[]): string {
  if (changes.length > MAX_EDIT_CHANGES) {
    throw new HelperProjectError("limit", `An edit holds at most ${MAX_EDIT_CHANGES} changes`);
  }
  const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let cursor = 0;
  let out = "";
  for (const { from, to, insert } of ordered) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < cursor || to < from || to > text.length) {
      throw new HelperProjectError("stale", "A change does not fit the helper's text");
    }
    out += text.slice(cursor, from) + insert;
    cursor = to;
  }
  return out + text.slice(cursor);
}
