// Reads and writes the `width` and `fig-align` attributes of images (`![a](s){width=60% fig-align="left"}`) and figure divs
// (`::: {.labshelf-figure source=… width=60% fig-align="right"}`); centre is the default alignment and is never written.
// CONTRACT: documents/contracts/qmd-items.md#figures
const TOKEN = /(?:[^\s"]+|"(?:[^"\\]|\\.)*")+/g;
const WIDTH = /^width=(.*)$/;

interface Token { readonly text: string; readonly start: number; readonly end: number }

function tokensOf(attributes: string): Token[] {
  return [...attributes.matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}

const unquote = (value: string): string => (value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value);

/** The `width=` value of the text between the braces of a Pandoc attribute block, unquoted; null without one. */
export function readAttrWidth(attributes: string | null): string | null {
  if (attributes === null) return null;
  for (const token of tokensOf(attributes)) {
    const match = WIDTH.exec(token.text);
    if (match) return unquote(match[1]!);
  }
  return null;
}

/** `attributes` with the `key=` token set to `key=value` (in place, or added after the last attribute) or removed (null); the other bytes are kept. */
function setAttr(attributes: string, key: string, value: string | null): string {
  const tokens = tokensOf(attributes);
  const index = tokens.findIndex((token) => token.text.startsWith(`${key}=`));
  const token = tokens[index];
  if (value !== null) {
    if (token) return attributes.slice(0, token.start) + `${key}=${value}` + attributes.slice(token.end);
    const after = tokens.at(-1)?.end ?? 0;
    return attributes.slice(0, after) + (after === 0 ? "" : " ") + `${key}=${value}` + attributes.slice(after);
  }
  if (!token) return attributes;
  // The whitespace before the token goes with it; for the first token, the whitespace after it.
  const from = index > 0 ? tokens[index - 1]!.end : token.start;
  const to = index > 0 ? token.end : (tokens[index + 1]?.start ?? token.end);
  return attributes.slice(0, from) + attributes.slice(to);
}

/** `attributes` with its `width=` set to `width` (in place, or added after the last attribute) or removed (null); the other bytes are kept. */
export function setAttrWidth(attributes: string, width: string | null): string {
  return setAttr(attributes, "width", width);
}

/** Where an image or figure sits in the column; centre is the default. */
export type MediaAlign = "left" | "center" | "right";

/** The `fig-align=` of the text between the braces of a Pandoc attribute block: left or right, else (none, centre or another value) centre. */
export function readAttrAlign(attributes: string | null): MediaAlign {
  if (attributes === null) return "center";
  for (const token of tokensOf(attributes)) {
    if (!token.text.startsWith("fig-align=")) continue;
    const value = unquote(token.text.slice("fig-align=".length));
    return value === "left" || value === "right" ? value : "center";
  }
  return "center";
}

/** `attributes` with `fig-align="left|right"` set in place or added, or removed for centre; the other bytes are kept. */
export function setAttrAlign(attributes: string, align: MediaAlign): string {
  return setAttr(attributes, "fig-align", align === "center" ? null : `"${align}"`);
}

/** The end (after `}`) of the attribute block that starts with `{` at `at`, on one line and without nested braces; -1 when there is none. */
export function matchAttributeBlock(source: string, at: number, end: number): number {
  if (source[at] !== "{") return -1;
  let quoted = false;
  for (let index = at + 1; index < end; index++) {
    const char = source[index];
    if (char === "\n" || (!quoted && char === "{")) return -1;
    if (quoted && char === "\\") index++;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === "}") return index + 1;
  }
  return -1;
}

/** The CSS width of a width value: a length with a CSS unit or a percentage, a bare number read as px (as Pandoc reads it); null for anything else. */
export function cssWidth(value: string | null): string | null {
  const match = value === null ? null : /^(\d+(?:\.\d+)?|\.\d+)(%|px|in|cm|mm|pt|pc|em|rem)?$/.exec(value);
  return match ? match[1]! + (match[2] ?? "px") : null;
}

/** The opener of a figure block: an optional byte order mark, `::: {`, the attributes, `}`. */
const FIGURE_OPENER = /^(﻿?::: \{)(\.labshelf-figure(?=[\s}])[^{}\r\n]*)\}/;

/** The attributes of a figure block's `.labshelf-figure` opener (between the braces), or null when the block does not start with one. */
export function figureAttributes(raw: string): string | null {
  return FIGURE_OPENER.exec(raw)?.[2] ?? null;
}

/** The `source=` value of figure attributes, or null. */
export function figureSource(attributes: string): string | null {
  for (const token of tokensOf(attributes)) if (token.text.startsWith("source=")) return unquote(token.text.slice("source=".length));
  return null;
}

/** The figure block `raw` with the opener's attributes passed through `edit`; a block without a `.labshelf-figure` opener is returned as is. */
function editFigureOpener(raw: string, edit: (attributes: string) => string): string {
  const match = FIGURE_OPENER.exec(raw);
  if (!match) return raw;
  return match[1]! + edit(match[2]!) + raw.slice(match[0].length - 1);
}

/** The figure block `raw` with the opener's width set or removed; a block without a `.labshelf-figure` opener is returned as is. */
export function setFigureWidth(raw: string, width: string | null): string {
  return editFigureOpener(raw, (attributes) => setAttrWidth(attributes, width));
}

/** The figure block `raw` with the opener's `fig-align` set, or removed for centre; a block without a `.labshelf-figure` opener is returned as is. */
export function setFigureAlign(raw: string, align: MediaAlign): string {
  return editFigureOpener(raw, (attributes) => setAttrAlign(attributes, align));
}

/** The new figure block `next` with the attributes of `previous`'s opener other than its source (a width, a label), so a rewrite of the block keeps them. */
export function carryFigureAttributes(previous: string, next: string): string {
  const old = figureAttributes(previous);
  const fresh = FIGURE_OPENER.exec(next);
  const source = fresh ? figureSource(fresh[2]!) : null;
  if (old === null || !fresh || source === null) return next;
  const attributes = old.replace(/(^|\s)source=(?:"(?:[^"\\]|\\.)*"|\S+)/, `$1source=${source}`);
  return fresh[1]! + attributes + next.slice(fresh[0].length - 1);
}
