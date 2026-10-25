/** Reads `\input`, `\include` and `\subfile`: the path as written with the range of its text. */
import type { IncludeFact } from "../facts.js";
import { readDelimited, findSpaceEnd } from "./delimited.js";
import type { ScanContext } from "./scanContext.js";

export const INCLUDE_COMMANDS: ReadonlySet<string> = new Set(["input", "include", "subfile"]);

export function readInclude(ctx: ScanContext, command: string, after: number): IncludeFact | undefined {
  const group = readDelimited(ctx.text, findSpaceEnd(ctx.text, after), "{");
  if (!group) { return undefined; }
  const path = ctx.text.slice(group.start, group.end).trim();
  if (!path) { return undefined; }
  const start = group.start + ctx.text.slice(group.start, group.end).indexOf(path);
  return { command, path, range: ctx.range(start, start + path.length) };
}
