// Edits a single-line text field with readline/emacs keys and bracketed paste.
// Pure state, so prompts, filter and pickers share it and tests drive it directly.
import type { InputEvent } from "../screen/index.js";

export interface TextInputState {
  value: string;
  /** Cursor position in code units, 0..value.length. */
  cursor: number;
}

/**
 * @returns a field holding `value` with the cursor at the end
 */
export function textInput(value = ""): TextInputState {
  return { value, cursor: value.length };
}

function wordLeft(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(value[i - 1]!)) { i--; }
  while (i > 0 && !/\s/.test(value[i - 1]!)) { i--; }
  return i;
}

function wordRight(value: string, cursor: number): number {
  let i = cursor;
  while (i < value.length && /\s/.test(value[i]!)) { i++; }
  while (i < value.length && !/\s/.test(value[i]!)) { i++; }
  return i;
}

// Steps over a whole code point (surrogate pairs) instead of half of one.
function prevIndex(value: string, cursor: number): number {
  if (cursor <= 0) { return 0; }
  const code = value.charCodeAt(cursor - 1);
  return code >= 0xdc00 && code <= 0xdfff && cursor >= 2 ? cursor - 2 : cursor - 1;
}

function nextIndex(value: string, cursor: number): number {
  if (cursor >= value.length) { return value.length; }
  const code = value.charCodeAt(cursor);
  return code >= 0xd800 && code <= 0xdbff ? cursor + 2 : cursor + 1;
}

/**
 * Applies one input event.
 * @returns the new state, or undefined when the event is not an editing key (the caller handles it)
 */
export function editText(state: TextInputState, event: InputEvent): TextInputState | undefined {
  const { value, cursor } = state;
  if (event.type === "paste") {
    const text = event.text.replace(/[\r\n]+/g, " ");
    return { value: value.slice(0, cursor) + text + value.slice(cursor), cursor: cursor + text.length };
  }
  if (event.type !== "key") { return undefined; }
  if (event.text !== undefined) {
    return { value: value.slice(0, cursor) + event.text + value.slice(cursor), cursor: cursor + event.text.length };
  }
  switch (event.id) {
    case "space":
      return { value: value.slice(0, cursor) + " " + value.slice(cursor), cursor: cursor + 1 };
    case "left": case "C-b": return { value, cursor: prevIndex(value, cursor) };
    case "right": case "C-f": return { value, cursor: nextIndex(value, cursor) };
    case "home": case "C-a": return { value, cursor: 0 };
    case "end": case "C-e": return { value, cursor: value.length };
    case "M-b": case "C-left": return { value, cursor: wordLeft(value, cursor) };
    case "M-f": case "C-right": return { value, cursor: wordRight(value, cursor) };
    case "backspace": case "C-h": {
      const from = prevIndex(value, cursor);
      return { value: value.slice(0, from) + value.slice(cursor), cursor: from };
    }
    case "delete": case "C-d":
      return { value: value.slice(0, cursor) + value.slice(nextIndex(value, cursor)), cursor };
    case "C-w": case "M-backspace": {
      const from = wordLeft(value, cursor);
      return { value: value.slice(0, from) + value.slice(cursor), cursor: from };
    }
    case "C-u": return { value: value.slice(cursor), cursor: 0 };
    case "C-k": return { value: value.slice(0, cursor), cursor };
    default: return undefined;
  }
}
