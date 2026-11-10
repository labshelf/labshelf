// The outline of a LaTeX or Typst talk (its slides) or poster (its blocks), the speaker notes of each slide, and slide moves on the source text.
import type { DeckKind } from "./deckSizes.js";
import { removeComments } from "../latex/index.js";
import { lineAt, lineEnd, lineStart } from "../text/index.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** One slide of a talk or one block of a poster: its title, its 1-based line, and the [start, end) range a slide move carries. */
export interface SourceDeckItem { title: string; line: number; start: number; end: number }

export { lineStart };

/** The balanced group opening at `open` (one of `{[(`), as [inner start, end after the closer]; null when it does not close. */
export function balancedGroup(text: string, open: number): [number, number] | null {
  const opener = text[open];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : opener === "(" ? ")" : undefined;
  if (!closer) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) return [open + 1, i + 1];
  }
  return null;
}

/** Skips whitespace from offset. */
export const skipSpace = (text: string, offset: number): number => {
  let i = offset;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
};

/** A title as one line: TeX or Typst markup kept, whitespace collapsed. */
export const cleanTitle = (raw: string): string => raw.replace(/\s+/g, " ").trim();

/** The first mandatory `{…}` argument after offset, skipping `<…>` overlay specs and `[…]` options; null when there is none. */
function firstArgument(text: string, offset: number): string | null {
  let i = skipSpace(text, offset);
  for (;;) {
    if (text[i] === "<") {
      const close = text.indexOf(">", i);
      if (close === -1) return null;
      i = skipSpace(text, close + 1);
    } else if (text[i] === "[") {
      const group = balancedGroup(text, i);
      if (!group) return null;
      i = skipSpace(text, group[1]);
    } else break;
  }
  if (text[i] !== "{") return null;
  const group = balancedGroup(text, i);
  return group ? text.slice(group[0], group[1] - 1) : null;
}

/** The [start, end) ranges of the `\\AtBeginSection[opt]{body}` and `\\AtBeginSubsection[opt]{body}` groups of comment-free LaTeX code. */
function latexSectionHooks(code: string): Array<[number, number]> {
  const hooks: Array<[number, number]> = [];
  const pattern = /\\AtBegin(?:Section|Subsection)\b/g;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    let i = skipSpace(code, match.index + match[0].length);
    if (code[i] === "[") {
      const group = balancedGroup(code, i);
      if (!group) continue;
      i = skipSpace(code, group[1]);
    }
    const group = code[i] === "{" ? balancedGroup(code, i) : null;
    const end = group ? group[1] : i;
    hooks.push([match.index, end]);
    pattern.lastIndex = end;
  }
  return hooks;
}

/** The offset after `\\begin{document}` in comment-free LaTeX code; 0 when the file has none. */
function latexDocumentStart(code: string): number {
  const match = /\\begin\s*\{document\}/.exec(code);
  return match ? match.index + match[0].length : 0;
}

/** One source frame of a beamer talk: where `\\begin{frame}` starts, where its arguments start, and the end after `\\end{frame}`. */
interface LatexFrameSpan { at: number; after: number; stop: number }

/**
 * The source frames of comment-free beamer code in order: each `\\begin{frame}…\\end{frame}` in the document body, leaving out the
 * frames inside `\\AtBeginSection` / `\\AtBeginSubsection` and those before `\\begin{document}`.
 */
function latexFrameSpans(code: string): LatexFrameSpan[] {
  const skipped: Array<[number, number]> = [[0, latexDocumentStart(code)], ...latexSectionHooks(code)];
  const spans: LatexFrameSpan[] = [];
  const begin = /\\begin\s*\{frame\}/g;
  for (let match = begin.exec(code); match; match = begin.exec(code)) {
    const inside = skipped.find(([from, to]) => match!.index >= from && match!.index < to);
    if (inside) { begin.lastIndex = inside[1]; continue; }
    const after = match.index + match[0].length;
    const end = /\\end\s*\{frame\}/g;
    end.lastIndex = after;
    const close = end.exec(code);
    const stop = close ? close.index + close[0].length : code.length;
    spans.push({ at: match.index, after, stop });
    begin.lastIndex = stop;
  }
  return spans;
}

function latexSlides(text: string): SourceDeckItem[] {
  const code = removeComments(text);
  return latexFrameSpans(code).map(({ at, after, stop }) => {
    const body = code.slice(after, stop);
    const titleArgument = firstArgument(code, after);
    const frameTitle = /\\frametitle\s*(?:<[^>]*>)?\s*(?:\[[^\]]*\])?\s*\{/.exec(body);
    const frameTitleText = frameTitle ? firstArgument(body, frameTitle.index + frameTitle[0].length - 1) : null;
    const title = cleanTitle(titleArgument ?? frameTitleText ?? (/\\(titlepage|maketitle)\b/.test(body) ? "Title page" : ""));
    return { title: title || "Untitled slide", line: lineAt(text, at), start: lineStart(text, at), end: lineEnd(text, Math.max(stop - 1, at)) };
  });
}

function latexPosterBlocks(text: string): SourceDeckItem[] {
  const code = removeComments(text);
  const items: SourceDeckItem[] = [];
  const block = /\\(?:block|headerbox)\b|\\begin\s*\{(?:block|alertblock|exampleblock|posterbox)\}/g;
  for (let match = block.exec(code); match; match = block.exec(code)) {
    const title = cleanTitle(firstArgument(code, match.index + match[0].length) ?? "");
    const at = lineStart(text, match.index);
    items.push({ title: title || "Untitled block", line: lineAt(text, match.index), start: at, end: lineEnd(text, match.index) });
  }
  return items;
}

/** A Typst slide call (`#slide`, `#title-slide`, …) at line start. */
export const TYPST_SLIDE_CALL = /^#(?:[a-z-]+\.)?(?:slide|title-slide|focus-slide|polylux-slide|matrix-slide|new-section-slide|centered-slide)\b/;

/** The text of the Typst content or string argument after offset (`[…]`, `("…")` or a `title: [...]` named argument); null when there is none. */
function typstSlideTitle(text: string, from: number, to: number): string | null {
  const body = text.slice(from, to);
  const named = /title:\s*(?:\[([^\]]*)\]|"([^"]*)")/.exec(body);
  if (named) return named[1] ?? named[2] ?? null;
  const heading = /^[ \t]*\[?[ \t]*=+[ \t]+(.+)$/m.exec(body);
  return heading ? heading[1]!.replace(/\]\s*$/, "") : null;
}

/** Typst slides: `#slide`-style calls at line start when the source has any, else level-2 headings; a slide runs to the next slide or level-1 heading. */
function typstSlides(text: string): SourceDeckItem[] {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const calls = lines.some((line) => TYPST_SLIDE_CALL.test(line));
  const starts: number[] = [];
  const stops: number[] = [];
  let inRaw = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) inRaw = !inRaw;
    if (inRaw) return;
    if (calls ? TYPST_SLIDE_CALL.test(line) : /^==[ \t]+\S/.test(line)) starts.push(index);
    else if (!calls && /^=[ \t]+\S/.test(line)) stops.push(index);
  });
  return starts.map((startLine, n) => {
    const nextStart = starts[n + 1] ?? lines.length;
    const nextStop = stops.find((stop) => stop > startLine && stop < nextStart) ?? nextStart;
    const start = offsets[startLine]!;
    const end = nextStop >= lines.length ? text.length : offsets[nextStop]!;
    const raw = calls ? typstSlideTitle(text, start, end) : lines[startLine]!.replace(/^==[ \t]+/, "");
    const title = cleanTitle(raw ?? "");
    return { title: title || `Slide ${n + 1}`, line: startLine + 1, start, end };
  });
}

function typstPosterBlocks(text: string): SourceDeckItem[] {
  const items: SourceDeckItem[] = [];
  const pattern = /^[ \t]*(=+)[ \t]+(.+)$|heading:\s*\[([^\]]*)\]/gm;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const title = cleanTitle(match[2] ?? match[3] ?? "");
    items.push({ title: title || "Untitled block", line: lineAt(text, match.index), start: lineStart(text, match.index), end: lineEnd(text, match.index) });
  }
  return items;
}

/** The slides of a talk or the blocks of a poster, in source order. */
export function readSourceDeckOutline(format: SourceDeckFormat, kind: DeckKind, text: string): SourceDeckItem[] {
  if (format === "latex") return kind === "talk" ? latexSlides(text) : latexPosterBlocks(text);
  return kind === "talk" ? typstSlides(text) : typstPosterBlocks(text);
}

/** The arguments of each `\note{…}` / `\note[…]{…}` (LaTeX) or `#speaker-note[…]` / `#speaker-note("…")` / `#pdfpc.speaker-note(…)` (Typst) in [from, to). */
function notesIn(format: SourceDeckFormat, text: string, from: number, to: number): string[] {
  const code = format === "latex" ? removeComments(text) : text;
  const pattern = format === "latex" ? /\\note\b/g : /#(?:pdfpc\.)?speaker-note\b/g;
  pattern.lastIndex = from;
  const notes: string[] = [];
  for (let match = pattern.exec(code); match && match.index < to; match = pattern.exec(code)) {
    let i = skipSpace(code, match.index + match[0].length);
    if (format === "latex") {
      const body = firstArgument(code, i);
      if (body !== null) notes.push(body);
      continue;
    }
    if (code[i] === "(") {
      const group = balancedGroup(code, i);
      if (!group) continue;
      const inner = code.slice(group[0], group[1] - 1).trim();
      notes.push(inner.replace(/^"([\s\S]*)"$/, "$1").replace(/^\[([\s\S]*)\]$/, "$1"));
      i = group[1];
    }
    if (code[i] === "[") {
      const group = balancedGroup(code, i);
      if (group) notes.push(code.slice(group[0], group[1] - 1));
    }
  }
  return notes.map((note) => note.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** The speaker notes of each slide of a talk, in slide order; "" for a slide without notes. */
export function readSourceDeckNotes(format: SourceDeckFormat, text: string): string[] {
  return readSourceDeckOutline(format, "talk", text).map((slide) => notesIn(format, text, slide.start, slide.end).join("\n\n"));
}

/** The source with slide `index` moved by `delta` places (-1 up, +1 down), the text between the two slides kept; null at either end. */
export function moveSourceSlide(text: string, slides: readonly SourceDeckItem[], index: number, delta: -1 | 1): string | null {
  const other = index + delta;
  if (index < 0 || other < 0 || index >= slides.length || other >= slides.length) return null;
  const [first, second] = delta === 1 ? [slides[index]!, slides[other]!] : [slides[other]!, slides[index]!];
  const a = withLineBreak(text.slice(first.start, first.end));
  const b = withLineBreak(text.slice(second.start, second.end));
  return text.slice(0, first.start) + b + text.slice(first.end, second.start) + a + text.slice(second.end);
}

/** The source with a copy of slide `index` right after it. */
export function duplicateSourceSlide(text: string, slides: readonly SourceDeckItem[], index: number): string | null {
  const slide = slides[index];
  if (!slide) return null;
  const copy = withLineBreak(text.slice(slide.start, slide.end));
  const before = withLineBreak(text.slice(0, slide.end));
  return before + copy + text.slice(slide.end);
}

/** The source without slide `index`. */
export function deleteSourceSlide(text: string, slides: readonly SourceDeckItem[], index: number): string | null {
  const slide = slides[index];
  if (!slide) return null;
  return text.slice(0, slide.start) + text.slice(slide.end);
}

const withLineBreak = (part: string): string => (part.endsWith("\n") || part === "" ? part : `${part}\n`);
