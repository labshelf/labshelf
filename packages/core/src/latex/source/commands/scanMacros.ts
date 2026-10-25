/** Reads `\newcommand`-style definitions and `\DeclareMathOperator` into macros MathJax can load. */
import type { MacroFact } from "../facts.js";
import { readDelimited, findSpaceEnd } from "./delimited.js";
import type { ScanContext } from "./scanContext.js";

export const MACRO_COMMANDS: ReadonlySet<string> = new Set([
  "newcommand", "renewcommand", "providecommand", "DeclareMathOperator",
]);

const NAME = /\\([A-Za-z]+)/y;

/** Reads `{\name}` or `\name` at `at`; returns the name and the offset after it. */
function readName(text: string, at: number): { name: string; next: number } | undefined {
  const braced = readDelimited(text, at, "{");
  const inner = braced ? text.slice(braced.start, braced.end).trim() : undefined;
  if (braced && inner !== undefined) {
    const match = /^\\([A-Za-z]+)$/.exec(inner);
    return match ? { name: match[1]!, next: braced.next } : undefined;
  }
  NAME.lastIndex = at;
  const bare = NAME.exec(text);
  return bare ? { name: bare[1]!, next: NAME.lastIndex } : undefined;
}

export function readMacro(ctx: ScanContext, command: string, from: number, after: number, starred: boolean): MacroFact | undefined {
  const { text } = ctx;
  const named = readName(text, findSpaceEnd(text, after));
  if (!named) { return undefined; }
  let at = findSpaceEnd(text, named.next);
  let argCount = 0;
  let defaultArg: string | undefined;
  if (command !== "DeclareMathOperator") {
    const count = readDelimited(text, at, "[");
    if (count && /^\s*[0-9]\s*$/.test(text.slice(count.start, count.end))) {
      argCount = Number(text.slice(count.start, count.end));
      at = findSpaceEnd(text, count.next);
      const fallback = readDelimited(text, at, "[");
      if (fallback) {
        defaultArg = text.slice(fallback.start, fallback.end);
        at = findSpaceEnd(text, fallback.next);
      }
    }
  }
  const body = readDelimited(text, at, "{");
  if (!body) { return undefined; }
  const raw = text.slice(body.start, body.end);
  return {
    command, name: named.name, argCount, defaultArg,
    body: command === "DeclareMathOperator" ? `\\operatorname${starred ? "*" : ""}{${raw}}` : raw,
    range: ctx.range(from, body.next),
  };
}
