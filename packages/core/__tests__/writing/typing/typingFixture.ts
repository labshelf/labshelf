// Writes typing-helper cases as marked text: ‸ is the cursor, «…» the selection.
import { DEFAULT_TYPING_HELPERS, deriveBackspaceEdit, deriveEnterEdit, deriveTypedEdit, type TypingEdit, type TypingHelperId, type TypingHelpers, type TypingLanguage } from "../../../src/writing/typing/index";

export function parseMarked(marked: string): { text: string; from: number; to: number } {
  const cursor = marked.indexOf("‸");
  if (cursor >= 0) return { text: marked.replace("‸", ""), from: cursor, to: cursor };
  const from = marked.indexOf("«");
  const to = marked.indexOf("»") - 1;
  return { text: marked.replace("«", "").replace("»", ""), from, to };
}

/** The text after the edit with the new selection marked, or undefined when the helper lets the default edit happen. */
export function renderEdit(text: string, edit: TypingEdit | undefined): string | undefined {
  if (!edit) return undefined;
  let out = text;
  for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  if (edit.anchor === edit.head) return `${out.slice(0, edit.head)}‸${out.slice(edit.head)}`;
  const [from, to] = edit.anchor < edit.head ? [edit.anchor, edit.head] : [edit.head, edit.anchor];
  return `${out.slice(0, from)}«${out.slice(from, to)}»${out.slice(to)}`;
}

export const without = (...ids: TypingHelperId[]): TypingHelpers => ({ ...DEFAULT_TYPING_HELPERS, ...Object.fromEntries(ids.map((id) => [id, false])) });

export function type(language: TypingLanguage, marked: string, typed: string, options: { helpers?: TypingHelpers; tracked?: number[] } = {}): string | undefined {
  const { text, from, to } = parseMarked(marked);
  const tracked = options.tracked ?? [];
  return renderEdit(text, deriveTypedEdit(language, options.helpers ?? DEFAULT_TYPING_HELPERS, text, from, to, typed, (pos) => tracked.includes(pos)));
}

/** Like `type`, with the closer right after the cursor tracked. */
export function typeOver(language: TypingLanguage, marked: string, typed: string): string | undefined {
  return type(language, marked, typed, { tracked: [parseMarked(marked).from] });
}

export function backspace(language: TypingLanguage, marked: string, helpers: TypingHelpers = DEFAULT_TYPING_HELPERS): string | undefined {
  const { text, from } = parseMarked(marked);
  return renderEdit(text, deriveBackspaceEdit(language, helpers, text, from));
}

export function enter(language: TypingLanguage, marked: string, helpers: TypingHelpers = DEFAULT_TYPING_HELPERS): string | undefined {
  const { text, from } = parseMarked(marked);
  return renderEdit(text, deriveEnterEdit(language, helpers, text, from, "  "));
}
