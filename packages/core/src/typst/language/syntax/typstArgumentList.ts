// Finds the bracket that closes a Typst argument list and splits the list into its top-level items.

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** The index of the bracket that closes the one at `open`, skipping strings; -1 when the text ends first. */
export function closingBracket(text: string, open: number): number {
  const closers: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') { i = stringEnd(text, i); continue; }
    if (OPENERS[ch] !== undefined) { closers.push(OPENERS[ch]); continue; }
    if (ch !== closers[closers.length - 1]) { continue; }
    closers.pop();
    if (closers.length === 0) { return i; }
  }
  return -1;
}

/** The comma-separated items of `list` at its own nesting level, trimmed, without empty ones. */
export function topLevelItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    if (ch === '"') { i = stringEnd(list, i); continue; }
    if (OPENERS[ch] !== undefined) { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === "," && depth === 0) { items.push(list.slice(start, i)); start = i + 1; }
  }
  items.push(list.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/** The index of the quote that closes the string opening at `quote`, or the last index when unclosed. */
function stringEnd(text: string, quote: number): number {
  for (let i = quote + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === '"') { return i; }
  }
  return text.length - 1;
}
