/** Reads sectioning commands: depth, title and extent, skipping the star and the optional short title. */
import type { SectionFact } from "../../facts.js";
import { readDelimited, skipSpace } from "./delimited.js";
import type { ScanContext } from "./scanContext.js";

export const SECTION_LEVELS: ReadonlyMap<string, number> = new Map([
  ["part", -1], ["chapter", 0], ["section", 1], ["subsection", 2], ["subsubsection", 3], ["paragraph", 4], ["subparagraph", 5],
]);

export function readSection(ctx: ScanContext, command: string, from: number, after: number, starred: boolean): SectionFact | undefined {
  let at = skipSpace(ctx.text, after);
  const short = readDelimited(ctx.text, at, "[");
  if (short) { at = skipSpace(ctx.text, short.next); }
  const title = readDelimited(ctx.text, at, "{");
  if (!title) { return undefined; }
  return {
    command, level: SECTION_LEVELS.get(command)!, starred,
    title: ctx.text.slice(title.start, title.end).replace(/\s+/g, " ").trim(),
    range: ctx.range(from, title.next),
  };
}
