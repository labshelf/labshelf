/** Adds the line that loads the generated values file to a LaTeX main file, once. */

export type ProjectValueInputResult =
  | { kind: "present" | "added"; text: string }
  /** Without `\begin{document}` the file is a fragment; the text is returned as it was. */
  | { kind: "no-document"; text: string };

const INPUT_LINE = String.raw`\input{labshelf-values}`;
const LOADS_VALUES = /^[^%\n]*\\input\{(?:[^}]*\/)?labshelf-values(?:\.tex)?\}/m;

function documentStart(text: string): number | undefined {
  for (const match of text.matchAll(/\\begin\{document\}/g)) {
    const lineStart = text.lastIndexOf("\n", match.index - 1) + 1;
    // TRAP: a `%` escaped as `\%` is text, not a comment.
    if (!/(?<!\\)%/.test(text.slice(lineStart, match.index))) { return match.index; }
  }
  return undefined;
}

/** The main file's text with the values file loaded before `\begin{document}`. */
export function withProjectValueInput(text: string): ProjectValueInputResult {
  if (LOADS_VALUES.test(text)) { return { kind: "present", text }; }
  const start = documentStart(text);
  if (start === undefined) { return { kind: "no-document", text }; }
  return { kind: "added", text: `${text.slice(0, start)}${INPUT_LINE}\n${text.slice(start)}` };
}
