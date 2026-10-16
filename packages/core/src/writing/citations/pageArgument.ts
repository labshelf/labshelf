/** Finds the page argument of a citation being typed — `\cite[` or `@key[` — so an editor can offer highlights there. */

import type { ProjectFormat } from "../project/index.js";

// The first optional argument of a cite command, still open at the cursor.
const LATEX_OPEN_PAGE = /\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*\[([^\]]*)$/;
// The rest of the argument, its closing bracket and the key list that follows, if any.
const LATEX_TAIL = /^[^\]]*\](\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\})?/;
const TYPST_OPEN_SUPPLEMENT = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)\[([^\]]*)$/u;

export interface PageArgumentContext {
  /** The cited key when the context names exactly one. */
  key?: string;
  /** Column where the typed page text begins. */
  start: number;
  /** Column of the `]` that closes the argument, when it is on the line. */
  close?: number;
  /** Whether a non-empty key list follows the argument (Typst always has its key before it). */
  hasKeys: boolean;
  /** Without keys: the column after the `]`, or after an empty `{}` that follows it. */
  end?: number;
  /** Column where the citation starts: the `\` of the command or the `@`. */
  commandStart: number;
}

function latexContext(before: string, after: string): PageArgumentContext | undefined {
  const open = LATEX_OPEN_PAGE.exec(before);
  if (!open) { return undefined; }
  const tail = LATEX_TAIL.exec(after);
  const list = tail?.[2];
  const hasKeys = list !== undefined && list.trim() !== "";
  return {
    ...(list !== undefined && !list.includes(",") && list.trim() !== "" ? { key: list.trim() } : {}),
    start: open.index + open[0].length - open[1]!.length,
    ...(tail ? { close: before.length + tail[0].indexOf("]") } : {}),
    hasKeys,
    ...(tail && !hasKeys ? { end: before.length + tail[0].length } : {}),
    commandStart: open.index,
  };
}

function typstContext(before: string, after: string): PageArgumentContext | undefined {
  const open = TYPST_OPEN_SUPPLEMENT.exec(before);
  if (!open) { return undefined; }
  const close = after.indexOf("]");
  return {
    key: open[1]!,
    start: open.index + open[0].length - open[2]!.length,
    ...(close === -1 ? {} : { close: before.length + close }),
    hasKeys: true,
    commandStart: open.index,
  };
}

/** The page-argument context at the cursor, given the line text before and after it, or undefined outside one. */
export function pageArgumentContext(format: ProjectFormat, before: string, after: string): PageArgumentContext | undefined {
  return format === "latex" ? latexContext(before, after) : typstContext(before, after);
}
