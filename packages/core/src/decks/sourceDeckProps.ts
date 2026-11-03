// Writes one property of a source deck node as a splice of the literal its reader (sourceDeckScan.ts) found, so every other byte stays.
import { readSourceDeckBlocks, type SourceDeckAlign, type SourceDeckNode, type SourceDeckRange } from "./sourceDeckBlocks.js";
import type { SourceDeckChange } from "./sourceDeckEdit.js";
import { balancedGroup, lineStart } from "./sourceDeckOutline.js";
import type { SourceDeckFormat } from "./sourceDecks.js";
import { at, blank, readSourceDeckAlign, readSourceDeckCaption, readSourceDeckColumnWidth, readSourceDeckSrc, readSourceDeckWidth, trimEnd } from "./sourceDeckScan.js";

/** The properties setSourceDeckProp writes (D5). */
export type SourceDeckPropName = "title" | "src" | "width" | "caption" | "align" | "column" | "columnWidth";

const splice = (text: string, [from, to]: SourceDeckRange, value: string): SourceDeckChange => ({ text: text.slice(0, from) + value + text.slice(to), cursor: from + value.length });

/** A fraction as a short literal: at most three decimals. */
const fraction = (value: number): string => String(Math.round(value * 1000) / 1000);
const inFraction = (value: unknown): value is number => typeof value === "number" && value >= 0.1 && value <= 1;

/** Whether the value's `{}` (LaTeX) or `[]` (Typst) pair up, escaped ones skipped, so it cannot close the group it is written into. */
export function isBalancedSourceText(format: SourceDeckFormat, value: string): boolean {
  const [open, close] = format === "latex" ? ["{", "}"] : ["[", "]"];
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\") i++;
    else if (value[i] === open) depth++;
    else if (value[i] === close && --depth < 0) return false;
  }
  return depth === 0;
}

/** Whether `value` can be written into the literal at `range`: one line, no quote inside a Typst string, balanced groups otherwise. */
function writable(format: SourceDeckFormat, text: string, range: SourceDeckRange, value: unknown): value is string {
  if (typeof value !== "string" || /[\n\r]/.test(value)) return false;
  return format === "typst" && text[range[0] - 1] === '"' ? !value.includes('"') : isBalancedSourceText(format, value);
}

const LATEX_DECLARATION: Record<SourceDeckAlign, string> = { left: "\\raggedright", center: "\\centering", right: "\\raggedleft" };
const LATEX_ENVIRONMENT: Record<SourceDeckAlign, string> = { left: "flushleft", center: "center", right: "flushright" };

/** The leading whitespace of the line holding `offset` when nothing else stands before it on the line, else "". */
const indentOf = (text: string, offset: number): string => { const before = text.slice(lineStart(text, offset), offset); return /^[ \t]*$/.test(before) ? before : ""; };

function setAlign(format: SourceDeckFormat, text: string, node: SourceDeckNode, align: SourceDeckAlign): SourceDeckChange | null {
  const form = readSourceDeckAlign(format, text, node.range);
  const source = text.slice(node.range[0], node.range[1]);
  if (format === "typst") return form ? splice(text, form.range, align) : splice(text, node.range, `#align(${align})[${source}]`);
  if (form && text[form.range[0]] === "\\") return splice(text, form.range, LATEX_DECLARATION[align]);
  if (form) {
    // An alignment environment: its name changes in `\begin` and in the matching `\end`.
    const name = text.slice(form.range[0], form.range[1]); const code = blank(format, text);
    const re = new RegExp(`\\\\(begin|end)\\s*\\{(${name})\\}`, "g");
    let depth = 1; let close: SourceDeckRange | null = null;
    for (let m = at(re, code, form.range[1] + 1); m && m.index < node.range[1]; m = re.exec(code)) {
      if (m[1] === "begin") depth++;
      else if (--depth === 0) { const start = m.index + m[0].length - 1 - name.length; close = [start, start + name.length]; break; }
    }
    if (!close) return null;
    const next = LATEX_ENVIRONMENT[align];
    const ended = text.slice(0, close[0]) + next + text.slice(close[1]);
    return splice(ended, form.range, next);
  }
  const header = at(/\\begin\s*\{[^}]+\}/y, text, node.range[0]);
  if (!header) {
    const indent = indentOf(text, node.range[0]); const env = LATEX_ENVIRONMENT[align];
    return splice(text, node.range, `\\begin{${env}}\n${indent}${source}\n${indent}\\end{${env}}`);
  }
  // `\centering` (or its sides) at the start of the environment's body, after its options and arguments on the header line.
  const code = blank(format, text); let end = node.range[0] + header[0].length;
  for (let p = end; ; ) {
    while (code[p] === " " || code[p] === "\t") p++;
    const argument = code[p] === "[" || code[p] === "{" ? balancedGroup(code, p) : null;
    if (!argument || argument[1] > node.range[1]) break;
    end = p = argument[1];
  }
  const newline = at(/[ \t]*\n([ \t]*)/y, text, end);
  const insert = newline ? `\n${newline[1]}${LATEX_DECLARATION[align]}` : `${LATEX_DECLARATION[align]} `;
  return splice(text, [end, end], insert);
}

/** The node's block moved to the end of poster column `index`; null when the node is not a block of a poster column. */
function setColumn(format: SourceDeckFormat, text: string, node: SourceDeckNode, index: number): SourceDeckChange | null {
  if (node.kind !== "block" || !Number.isInteger(index)) return null;
  const columns = readSourceDeckBlocks(format, "poster", text).filter((n) => n.kind === "column");
  const target = columns[index];
  const inColumn = columns.some((column) => column.children?.some((child) => child.range[0] === node.range[0] && child.range[1] === node.range[1]));
  if (!target?.bodyRange || !inColumn) return null;
  // The block's whole lines when it stands alone on them, else just its range.
  const start = indentOf(text, node.range[0]) || text[node.range[0] - 1] === "\n" || node.range[0] === 0 ? lineStart(text, node.range[0]) : node.range[0];
  const after = at(/[ \t]*(?:\n|$)/y, text, node.range[1]);
  const end = after ? node.range[1] + after[0].length : node.range[1];
  const segment = text.slice(start, node.range[1]);
  let p = trimEnd(text, target.bodyRange[0], target.bodyRange[1]);
  if (p > start && p <= end) return { text, cursor: node.range[1] };
  if (p >= end) p -= end - start;
  const rest = text.slice(0, start) + text.slice(end);
  return splice(rest, [p, p], `\n${segment}`);
}

/**
 * The text with one property of `node` rewritten as a splice of its span; the cursor goes to the end of the new span.
 * Null when the node does not carry the property in a known form or the value does not fit it: `code` nodes never do,
 * `width` and `columnWidth` take 0.1 to 1, Typst columns have no width, and `column` (a 0-based poster column) moves a block to its end.
 * A missing `align` is added: `\centering` (or `\raggedright`, `\raggedleft`) at the start of a LaTeX environment's body,
 * a `center`/`flushleft`/`flushright` environment around any other LaTeX node, or `#align(…)[…]` around a Typst node.
 */
export function setSourceDeckProp(format: SourceDeckFormat, text: string, node: SourceDeckNode, prop: SourceDeckPropName, value: string | number): SourceDeckChange | null {
  if (node.kind === "code") return null;
  const figure = node.kind === "figure";
  switch (prop) {
    case "title": return node.titleRange && writable(format, text, node.titleRange, value) ? splice(text, node.titleRange, value) : null;
    case "src": {
      const form = figure ? readSourceDeckSrc(format, text, node.range) : null;
      return form && writable(format, text, form.range, value) && value.trim() && (format === "typst" || !/[{}]/.test(value)) ? splice(text, form.range, value) : null;
    }
    case "width": {
      const form = figure && inFraction(value) ? readSourceDeckWidth(format, text, node.range) : null;
      return form ? splice(text, form.range, format === "latex" ? fraction(value as number) : `${Math.round((value as number) * 1000) / 10}%`) : null;
    }
    case "caption": {
      const form = figure ? readSourceDeckCaption(format, text, node.range) : null;
      return form && writable(format, text, form.range, value) ? splice(text, form.range, value) : null;
    }
    case "align": return (figure || node.kind === "text") && (value === "left" || value === "center" || value === "right") ? setAlign(format, text, node, value) : null;
    case "column": return typeof value === "number" ? setColumn(format, text, node, value) : null;
    case "columnWidth": {
      const form = node.kind === "column" && inFraction(value) ? readSourceDeckColumnWidth(format, text, node.range) : null;
      return form ? splice(text, form.range, fraction(value as number)) : null;
    }
  }
}
