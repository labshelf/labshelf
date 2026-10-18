/** Lists the document-body definitions that come before a section in source order, following the includes that lead to it. */
import { resolveIncludePath, scanLatexSource } from "../../source/index.js";
import { collectDefinitions } from "./assembly/index.js";

export interface DefinitionsBeforeSectionInput {
  /** Project-root-relative path to text. */
  sources: Readonly<Record<string, string>>;
  main: string;
  editedFile: string;
  /** Zero-based line of the section's first line in `editedFile`. */
  startLine: number;
}

const BEGIN_DOCUMENT = /\\begin\s*\{document\}/;

function includeTarget(path: string, sources: Readonly<Record<string, string>>): string | undefined {
  const target = resolveIncludePath(path);
  return target !== undefined && target in sources ? target : undefined;
}

function piece(lines: readonly string[], from: number, to: number): string {
  return lines.slice(from, to).join("\n");
}

/** Walks one file; returns true once the edited file's stop line is reached. */
function walk(file: string, input: DefinitionsBeforeSectionInput, out: string[], active: Set<string>): boolean {
  const text = input.sources[file]!;
  const lines = text.split("\n");
  const isEdited = file === input.editedFile;
  const end = isEdited ? Math.min(input.startLine, lines.length) : lines.length;
  const begin = file === input.main ? lines.findIndex((line) => BEGIN_DOCUMENT.test(line)) + 1 : 0;
  const includes = scanLatexSource(text).includes
    .filter((include) => include.range.start.line >= begin && include.range.start.line < end)
    .sort((a, b) => a.range.start.line - b.range.start.line);
  let cursor = begin;
  const flush = (to: number): void => {
    const body = piece(lines, cursor, to);
    out.push(...collectDefinitions(body, scanLatexSource(body)));
  };
  for (const include of includes) {
    const target = includeTarget(include.path, input.sources);
    if (target === undefined || active.has(target) || include.range.start.line < cursor) { continue; }
    flush(include.range.start.line);
    cursor = include.range.end.line + 1;
    active.add(target);
    const reached = walk(target, input, out, active);
    active.delete(target);
    if (reached) { return true; }
  }
  flush(Math.max(end, cursor));
  return isEdited;
}

export function definitionsBeforeSection(input: DefinitionsBeforeSectionInput): string[] {
  if (!(input.main in input.sources)) { return []; }
  const out: string[] = [];
  walk(input.main, input, out, new Set([input.main]));
  return out;
}
