/** Finds what in a section's text keeps it from typesetting alone the way it does in the full build. */
import { scanLatexSource, stripComments } from "../../../source/index.js";
import { collectDefinitions } from "./collectDefinitions.js";
import { sourcePathKey } from "./sourcePaths.js";

export type SectionTextFallback = "include" | "input-unreadable" | "input-with-definitions" | "afterpage" | "unclosed-float";

const INPUT = /\\input(?![A-Za-z@])/g;
const AFTERPAGE = /\\afterpage(?![A-Za-z@])/;
const FLOAT = /\\(begin|end)\s*\{((?:figure|table)\*?)\}/g;

/** A float opened in this section and closed in the next one would be cut in half. */
function hasUnclosedFloat(text: string): boolean {
  const open = new Map<string, number>();
  for (const [, side, name] of text.matchAll(FLOAT)) {
    open.set(name!, (open.get(name!) ?? 0) + (side === "begin" ? 1 : -1));
  }
  return [...open.values()].some((count) => count > 0);
}

/** An `\input` file that defines macros would define them before the section in the full build but after the restore here. */
function inputFallback(text: string, stripped: string, sources: ReadonlyMap<string, string>): SectionTextFallback | undefined {
  const inputs = scanLatexSource(text).includes.filter((include) => include.command === "input");
  // TRAP: the scanner reads only braced paths, so `\input chap` is counted here but never resolved.
  if (inputs.length < [...stripped.matchAll(INPUT)].length) { return "input-unreadable"; }
  for (const input of inputs) {
    const source = sources.get(sourcePathKey(input.path));
    if (source === undefined) { return "input-unreadable"; }
    if (collectDefinitions(source, scanLatexSource(source)).length > 0) { return "input-with-definitions"; }
  }
  return undefined;
}

export function sectionTextFallback(text: string, sources: ReadonlyMap<string, string>): SectionTextFallback | undefined {
  const stripped = stripComments(text);
  if (scanLatexSource(text).includes.some((include) => include.command === "include")) { return "include"; }
  if (AFTERPAGE.test(stripped)) { return "afterpage"; }
  if (hasUnclosedFloat(stripped)) { return "unclosed-float"; }
  return inputFallback(text, stripped, sources);
}
