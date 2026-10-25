/** Reads `\label` and the `\ref` family: each label or referenced name with the range of its text. */
import type { LabelFact, ReferenceFact } from "../facts.js";
import { readDelimited, findSpaceEnd } from "./delimited.js";
import type { ScanContext } from "./scanContext.js";

export const REF_COMMANDS: ReadonlySet<string> = new Set([
  "ref", "eqref", "pageref", "autoref", "nameref", "cref", "Cref", "vref", "Vref", "cpageref", "Cpageref",
]);

interface NameAt { name: string; start: number; end: number }

function namesIn(ctx: ScanContext, start: number, end: number, split: boolean): NameAt[] {
  const names: NameAt[] = [];
  let offset = start;
  for (const part of split ? ctx.text.slice(start, end).split(",") : [ctx.text.slice(start, end)]) {
    const name = part.trim();
    // Names with `#` are macro parameters inside a definition, not real labels.
    if (name && !name.includes("#")) {
      const lead = part.length - part.trimStart().length;
      names.push({ name, start: offset + lead, end: offset + lead + name.length });
    }
    offset += part.length + 1;
  }
  return names;
}

export function readLabel(ctx: ScanContext, after: number): LabelFact | undefined {
  const group = readDelimited(ctx.text, findSpaceEnd(ctx.text, after), "{");
  const [found] = group ? namesIn(ctx, group.start, group.end, false) : [];
  return found && { name: found.name, range: ctx.range(found.start, found.end) };
}

export function readReferences(ctx: ScanContext, command: string, after: number): ReferenceFact[] {
  const group = readDelimited(ctx.text, findSpaceEnd(ctx.text, after), "{");
  if (!group) { return []; }
  return namesIn(ctx, group.start, group.end, true)
    .map((found) => ({ command, name: found.name, range: ctx.range(found.start, found.end) }));
}
