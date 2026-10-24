/** Scans one LaTeX source for labels, references, headings, macro definitions and includes. */
import type { LatexSourceFacts } from "./facts.js";
import {
  createScanContext, INCLUDE_COMMANDS, MACRO_COMMANDS, readInclude, readLabel, readMacro, readRefs, readSection,
  REF_COMMANDS, SECTION_LEVELS,
} from "./commands/index.js";
import { stripComments } from "./stripComments.js";

const COMMAND = /\\([A-Za-z]+)(\*?)/g;

export function scanLatexSource(text: string): LatexSourceFacts {
  const ctx = createScanContext(stripComments(text));
  const facts: LatexSourceFacts = { labels: [], refs: [], sections: [], macros: [], includes: [] };
  for (const match of ctx.text.matchAll(COMMAND)) {
    const [whole, command, star] = match as unknown as [string, string, string];
    const from = match.index;
    const after = from + whole.length;
    const starred = star === "*";
    if (command === "label") { push(facts.labels, readLabel(ctx, after)); }
    else if (REF_COMMANDS.has(command)) { facts.refs.push(...readRefs(ctx, command, after)); }
    else if (SECTION_LEVELS.has(command)) { push(facts.sections, readSection(ctx, command, from, after, starred)); }
    else if (MACRO_COMMANDS.has(command)) { push(facts.macros, readMacro(ctx, command, from, after, starred)); }
    else if (INCLUDE_COMMANDS.has(command)) { push(facts.includes, readInclude(ctx, command, after)); }
  }
  return facts;
}

function push<T>(into: T[], fact: T | undefined): void {
  if (fact) { into.push(fact); }
}
