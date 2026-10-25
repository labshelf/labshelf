/** Flattens a LaTeX include tree into the pieces of text in the order they read, each include at the place it is written. */
import { lineStarts } from "../../text/index.js";
import type { ProjectSourceFile } from "../../../latex/source/index.js";
import { resolveIncludePath } from "../../../latex/source/index.js";

/** `files` lists the main file first; a file reached twice is placed at its first include only. */
export function readingOrderTexts(files: readonly ProjectSourceFile[], texts: ReadonlyMap<string, string>): { text: string }[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const placed = new Set<string>();
  const pieces: { text: string }[] = [];
  const place = (file: ProjectSourceFile): void => {
    placed.add(file.path);
    const text = texts.get(file.path) ?? "";
    const starts = lineStarts(text);
    let cursor = 0;
    for (const include of file.facts.includes) {
      const target = resolveIncludePath(include.path);
      const child = target === undefined || placed.has(target) ? undefined : byPath.get(target);
      if (child === undefined) { continue; }
      const { start, end } = include.range;
      // TRAP: the include range covers the path argument only, so the cut moves back to the command's backslash and past the closing brace.
      const argumentStart = (starts[start.line] ?? 0) + start.character;
      const argumentEnd = (starts[end.line] ?? 0) + end.character;
      pieces.push({ text: text.slice(cursor, Math.max(cursor, text.lastIndexOf("\\", argumentStart))) });
      place(child);
      cursor = text[argumentEnd] === "}" ? argumentEnd + 1 : argumentEnd;
    }
    pieces.push({ text: text.slice(cursor) });
  };
  const main = files[0];
  if (main !== undefined) { place(main); }
  return pieces;
}
