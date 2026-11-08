// The Style block of a LaTeX or Typst deck: which template the source uses, the `labshelf:style` block it holds (read back, hand edits
// included) and the block rewritten from a DeckStyle as one change that touches nothing outside it.
import { removeComments } from "../latex/index.js";
import { normaliseDeckColour, normaliseDeckFont, isDeckScale, normaliseDeckStyle, validateDeckStyle, type DeckStyle, type DeckStyleColourToken, type DeckStyleFontToken } from "./deckStyleTokens.js";
import type { SourceDeckChange } from "./sourceDeckEdit.js";
import { detectSourceDeckKind, type SourceDeckFormat } from "./sourceDecks.js";

export type SourceDeckTemplate = "beamer" | "beamerposter" | "tikzposter" | "typst" | "touying" | "peace-of-posters";

export interface SourceDeckStyleRead { template: SourceDeckTemplate; block: { from: number; to: number; text: string } | null; style: Partial<DeckStyle> }

const DOCUMENT_CLASS = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{\s*([A-Za-z0-9-]+)\s*\}/;
const BEAMERPOSTER_PACKAGE = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbeamerposter\b[^}]*\}/;
const TYPST_PREVIEW_IMPORT = /^[ \t]*#import\s+"@preview\/([a-z0-9-]+):[^"]*"([^\n]*)$/gm;
const POP_CALLS = "(?:set-theme|update-theme|set-poster-layout|update-poster-layout)";

/** The template of a LaTeX or Typst deck, from its class, packages or imports with comments ignored; null when it is no deck of a known template. */
export function sourceDeckTemplate(format: SourceDeckFormat, text: string): SourceDeckTemplate | null {
  if (format === "latex") {
    const code = removeComments(text);
    const documentClass = DOCUMENT_CLASS.exec(code)?.[1];
    if (documentClass === "tikzposter") return "tikzposter";
    if (documentClass === "beamer") return BEAMERPOSTER_PACKAGE.test(code) ? "beamerposter" : "beamer";
    return null;
  }
  const packages = typstImports(text).map((entry) => entry.name);
  if (packages.includes("touying")) return "touying";
  if (packages.includes("peace-of-posters")) return "peace-of-posters";
  return detectSourceDeckKind(format, text) === null ? null : "typst";
}

/** The template, the style block when there is a closed one, and the tokens it sets; null when the source is no deck of a known template. */
export function readSourceDeckStyle(format: SourceDeckFormat, text: string): SourceDeckStyleRead | null {
  const template = sourceDeckTemplate(format, text);
  if (template === null) return null;
  const found = locateBlock(format, text);
  if (found === null || found === "open") return { template, block: null, style: {} };
  const block = { from: found.from, to: found.to, text: text.slice(found.from, found.to) };
  return { template, block, style: format === "latex" ? readLatexStyle(block.text) : readTypstStyle(block.text) };
}

/** The source with its style block written from the style (replaced in place, or added at the template's place); null for an unknown template, an opening marker without its end or an invalid style. */
export function setSourceDeckStyle(format: SourceDeckFormat, text: string, style: DeckStyle): SourceDeckChange | null {
  const template = sourceDeckTemplate(format, text);
  if (template === null || validateDeckStyle(style).length > 0) return null;
  const found = locateBlock(format, text);
  if (found === "open") return null;
  const block = canonicalBlock(template, normaliseDeckStyle(style), text);
  if (found !== null) return { text: text.slice(0, found.from) + block + text.slice(found.to), cursor: found.from };
  const at = format === "latex" ? latexInsertion(text) : typstInsertion(template, text);
  const prefix = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
  return { text: text.slice(0, at) + prefix + block + text.slice(at), cursor: at + prefix.length };
}

// --- the block in the text ---

function markers(format: SourceDeckFormat): { open: RegExp; close: RegExp } {
  const comment = format === "latex" ? "%" : "\\/\\/";
  return {
    open: new RegExp(`^[ \\t]*${comment}[ \\t]*labshelf:style[ \\t]*\\r?$`, "gm"),
    close: new RegExp(`^[ \\t]*${comment}[ \\t]*labshelf:style[ \\t]+end[ \\t]*\\r?$`, "gm"),
  };
}

/** The closed block from the start of its opening line to the end of its closing line (newline included); "open" for an opening marker without its end. */
function locateBlock(format: SourceDeckFormat, text: string): { from: number; to: number } | "open" | null {
  const { open, close } = markers(format);
  const start = open.exec(text);
  if (start === null) return null;
  close.lastIndex = start.index + start[0].length;
  const end = close.exec(text);
  if (end === null) return "open";
  const endOfLine = end.index + end[0].length;
  return { from: start.index, to: text[endOfLine] === "\n" ? endOfLine + 1 : endOfLine };
}

/** The lines between the markers. */
function innerLines(block: string): string[] {
  return block.split("\n").slice(1, -1).map((line) => line.replace(/\r$/, ""));
}

// --- read-back ---

const LATEX_COLOURS: Record<string, DeckStyleColourToken> = { Primary: "primary", Accent: "accent", Background: "background", Text: "text", Muted: "muted" };

function readLatexStyle(block: string): Partial<DeckStyle> {
  const style: Partial<DeckStyle> = {};
  for (const line of innerLines(block)) {
    const colour = /^\s*\\definecolor\s*\{\s*ls(Primary|Accent|Background|Text|Muted)\s*\}\s*\{\s*(HTML|rgb|RGB)\s*\}\s*\{([^}]*)\}\s*$/.exec(line);
    if (colour) {
      const hex = latexColour(colour[2]!, colour[3]!);
      if (hex !== null) style[LATEX_COLOURS[colour[1]!]!] = hex;
      continue;
    }
    const font = /^\s*\\(setmainfont|setmonofont|newfontfamily\s*\\lsHeadingFont)\s*(?:\[[^\]]*\])?\s*\{(.*)\}\s*$/.exec(line);
    if (font) {
      const name = normaliseDeckFont(font[2]!);
      const token: DeckStyleFontToken = font[1] === "setmainfont" ? "bodyFont" : font[1] === "setmonofont" ? "monoFont" : "headingFont";
      if (name !== null) style[token] = name;
      continue;
    }
    const scale = /^\s*\\def\s*\\lsScale\s*\{(.*)\}\s*$/.exec(line);
    if (scale) setScale(style, scale[1]!);
  }
  return style;
}

function latexColour(model: string, value: string): string | null {
  if (model === "HTML") return /^\s*[0-9A-Fa-f]{6}\s*$/.test(value) ? `#${value.trim().toLowerCase()}` : null;
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !/^\d*\.?\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  const bytes = model === "rgb" ? numbers.map((n) => (n <= 1 ? Math.round(n * 255) : Number.NaN)) : numbers.map((n) => (Number.isInteger(n) && n <= 255 ? n : Number.NaN));
  return rgbBytesToHex(bytes);
}

const TYPST_FONTS: Record<string, DeckStyleFontToken> = { heading: "headingFont", body: "bodyFont", mono: "monoFont" };

function readTypstStyle(block: string): Partial<DeckStyle> {
  const style: Partial<DeckStyle> = {};
  for (const line of innerLines(block)) {
    const colour = /^\s*#let\s+ls-(primary|accent|background|text|muted)\s*=\s*rgb\(\s*(.*?)\s*\)\s*$/.exec(line);
    if (colour) {
      const hex = typstColour(colour[2]!);
      if (hex !== null) style[colour[1] as DeckStyleColourToken] = hex;
      continue;
    }
    const font = /^\s*#let\s+ls-(heading|body|mono)-font\s*=\s*"(.*)"\s*$/.exec(line);
    if (font) {
      const name = normaliseDeckFont(font[2]!);
      if (name !== null) style[TYPST_FONTS[font[1]!]!] = name;
      continue;
    }
    const scale = /^\s*#let\s+ls-scale\s*=\s*(.*?)\s*$/.exec(line);
    if (scale) setScale(style, scale[1]!);
  }
  return style;
}

function typstColour(args: string): string | null {
  const quoted = /^"([^"]*)"$/.exec(args);
  if (quoted) return normaliseDeckColour(quoted[1]!);
  const parts = args.split(",").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return rgbBytesToHex(parts.map((part) => (Number(part) <= 255 ? Number(part) : Number.NaN)));
}

function rgbBytesToHex(bytes: number[]): string | null {
  if (bytes.some((n) => !Number.isFinite(n))) return null;
  return `#${bytes.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function setScale(style: Partial<DeckStyle>, raw: string): void {
  const value = raw.trim() === "" ? Number.NaN : Number(raw.trim());
  if (isDeckScale(value)) style.scale = value;
}

// --- the canonical block ---

function canonicalBlock(template: SourceDeckTemplate, style: DeckStyle, text: string): string {
  const latex = template === "beamer" || template === "beamerposter" || template === "tikzposter";
  const body = latex ? latexBody(template, style) : typstBody(template, style, text);
  const comment = latex ? "%" : "//";
  return [`${comment} labshelf:style`, ...body, `${comment} labshelf:style end`, ""].join("\n");
}

function latexBody(template: SourceDeckTemplate, style: DeckStyle): string[] {
  const hex = (value: string) => value.slice(1).toUpperCase();
  const lines = [
    `\\definecolor{lsPrimary}{HTML}{${hex(style.primary)}}`,
    `\\definecolor{lsAccent}{HTML}{${hex(style.accent)}}`,
    `\\definecolor{lsBackground}{HTML}{${hex(style.background)}}`,
    `\\definecolor{lsText}{HTML}{${hex(style.text)}}`,
    `\\definecolor{lsMuted}{HTML}{${hex(style.muted)}}`,
    `\\def\\lsScale{${String(style.scale)}}`,
    "\\iftutex",
    "  \\usepackage{fontspec}",
    `  \\setmainfont{${style.bodyFont}}`,
    `  \\setsansfont{${style.bodyFont}}`,
    `  \\setmonofont{${style.monoFont}}`,
    `  \\newfontfamily\\lsHeadingFont{${style.headingFont}}`,
    "\\else",
    "  \\let\\lsHeadingFont\\relax",
    "\\fi",
  ];
  if (template === "tikzposter") {
    const colours: Array<[string, string]> = [
      ["backgroundcolor", "lsBackground"], ["framecolor", "lsPrimary"], ["titlefgcolor", "lsBackground"], ["titlebgcolor", "lsPrimary"],
      ["blocktitlebgcolor", "lsPrimary"], ["blocktitlefgcolor", "lsBackground"], ["blockbodybgcolor", "lsBackground"], ["blockbodyfgcolor", "lsText"],
      ["innerblocktitlebgcolor", "lsAccent"], ["innerblocktitlefgcolor", "lsBackground"], ["innerblockbodybgcolor", "lsBackground"],
      ["innerblockbodyfgcolor", "lsText"], ["notefgcolor", "lsText"], ["notebgcolor", "lsBackground"], ["noteframecolor", "lsMuted"],
    ];
    return [
      ...lines,
      "\\definecolorstyle{labshelf}{\\colorlet{colorOne}{lsPrimary}\\colorlet{colorTwo}{lsAccent}\\colorlet{colorThree}{lsMuted}}{",
      ...colours.map(([name, colour]) => `  \\colorlet{${name}}{${colour}}`),
      "}",
      "\\usecolorstyle{labshelf}",
    ];
  }
  return [
    ...lines,
    "\\setbeamercolor{normal text}{fg=lsText,bg=lsBackground}",
    "\\setbeamercolor{background canvas}{bg=lsBackground}",
    "\\setbeamercolor{structure}{fg=lsPrimary}",
    "\\setbeamercolor{frametitle}{fg=lsPrimary,bg=lsBackground}",
    "\\setbeamercolor{title}{fg=lsPrimary,bg=lsBackground}",
    "\\setbeamercolor{block title}{fg=lsBackground,bg=lsPrimary}",
    "\\setbeamercolor{alerted text}{fg=lsAccent}",
    "\\setbeamercolor{footline}{fg=lsMuted}",
    "\\setbeamerfont{frametitle}{family=\\lsHeadingFont}",
    "\\setbeamerfont{title}{family=\\lsHeadingFont}",
  ];
}

function typstBody(template: SourceDeckTemplate, style: DeckStyle, text: string): string[] {
  const common = [
    `#let ls-primary = rgb("${style.primary}")`,
    `#let ls-accent = rgb("${style.accent}")`,
    `#let ls-background = rgb("${style.background}")`,
    `#let ls-text = rgb("${style.text}")`,
    `#let ls-muted = rgb("${style.muted}")`,
    `#let ls-heading-font = "${style.headingFont}"`,
    `#let ls-body-font = "${style.bodyFont}"`,
    `#let ls-mono-font = "${style.monoFont}"`,
    `#let ls-scale = ${String(style.scale)}`,
  ];
  const rules = [
    "#set text(font: ls-body-font, fill: ls-text, size: ls-scale * 1em)",
    "#show heading: set text(font: ls-heading-font, fill: ls-primary)",
    "#show raw: set text(font: ls-mono-font)",
    "#show link: set text(fill: ls-accent)",
  ];
  if (template === "touying") {
    return [
      ...common,
      "#let ls-colors = config-colors(primary: ls-primary, secondary: ls-accent, tertiary: ls-muted, neutral-lightest: ls-background, neutral-darkest: ls-text)",
      ...rules,
    ];
  }
  if (template === "peace-of-posters") {
    return [
      ...common,
      `#${popPrefix(text)}update-theme(heading-box-args: (fill: ls-primary, stroke: ls-primary), heading-text-args: (fill: ls-background, font: ls-heading-font), body-box-args: (fill: ls-background, stroke: ls-primary), body-text-args: (fill: ls-text, font: ls-body-font))`,
      "#set text(font: ls-body-font, fill: ls-text)",
    ];
  }
  return [...common, "#set page(fill: ls-background)", ...rules];
}

/** The @preview imports outside comments, each with the rest of its line. */
function typstImports(text: string): Array<{ name: string; rest: string }> {
  const code = text.replace(/^[ \t]*\/\/[^\n]*$/gm, "");
  return [...code.matchAll(TYPST_PREVIEW_IMPORT)].map((match) => ({ name: match[1]!, rest: match[2]! }));
}

/** The prefix peace-of-posters functions take: `pop.` for `as pop`, none for an item import, the package name for a bare import. */
function popPrefix(text: string): string {
  const entry = typstImports(text).find((item) => item.name === "peace-of-posters");
  if (entry === undefined) return "";
  const alias = /^\s*as\s+([A-Za-z_][\w-]*)/.exec(entry.rest);
  if (alias) return `${alias[1]}.`;
  return /^\s*:/.test(entry.rest) ? "" : "peace-of-posters.";
}

// --- placement of a new block ---

const LATEX_PREAMBLE_LINE = /^[ \t]*\\(?:documentclass|usepackage|RequirePackage|use[A-Za-z]+)(?![A-Za-z])/;

/** The start of the line after the last \documentclass, \usepackage, \RequirePackage or \use… line before \begin{document}. */
function latexInsertion(text: string): number {
  const begin = /\\begin\s*\{document\}/.exec(removeCommentsKeepingOffsets(text));
  const limit = begin === null ? text.length : begin.index;
  let at = 0;
  let line = 0;
  while (line < limit) {
    const end = endOfLine(text, line);
    if (LATEX_PREAMBLE_LINE.test(text.slice(line, end))) at = statementEnd(text, line, "latex");
    line = Math.max(end + 1, at);
  }
  return Math.min(at, limit);
}

/** The text with each LaTeX comment blanked out, offsets kept. */
function removeCommentsKeepingOffsets(text: string): string {
  return text.replace(/(^|[^\\])(%[^\n]*)/gm, (_all, lead: string, comment: string) => lead + " ".repeat(comment.length));
}

/** After the last top-level preamble statement of a Typst source (a touying or peace-of-posters show-everything rule ends the preamble). */
function typstInsertion(template: SourceDeckTemplate, text: string): number {
  const prefix = template === "peace-of-posters" ? popPrefix(text).replace(/[.]/g, "\\.") : "";
  const popCall = template === "peace-of-posters" ? new RegExp(`^#(?:${prefix})?${POP_CALLS}\\s*\\(`) : null;
  const themed = template === "touying" || template === "peace-of-posters";
  let at = -1;
  let commentEnd = 0;
  let pos = 0;
  while (pos < text.length) {
    const end = endOfLine(text, pos);
    const line = text.slice(pos, end);
    const trimmed = line.trim();
    if (trimmed === "") { pos = end + 1; continue; }
    if (trimmed.startsWith("//")) { commentEnd = Math.min(end + 1, text.length); pos = end + 1; continue; }
    if (trimmed.startsWith("/*")) {
      const close = text.indexOf("*/", pos);
      if (close === -1) break;
      commentEnd = Math.min(endOfLine(text, close) + 1, text.length);
      pos = commentEnd;
      continue;
    }
    if (themed && /^#show\s*:/.test(line)) break;
    if (!/^#(?:import|set|show|let)(?![\w-])/.test(line) && !(popCall?.test(line) ?? false)) break;
    at = statementEnd(text, pos, "typst");
    pos = at;
  }
  return at === -1 ? commentEnd : at;
}

function endOfLine(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
}

/** The end (after its newline) of the statement starting at `from`: the first line end where (), [] and {} balance, strings and comments skipped. */
function statementEnd(text: string, from: number, format: SourceDeckFormat): number {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\n") {
      if (depth <= 0) return i + 1;
    } else if (format === "latex") {
      if (c === "\\") i++;
      else if (c === "%") { i = endOfLine(text, i); continue; }
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") depth--;
    } else if (c === "/" && text[i + 1] === "/") { i = endOfLine(text, i); continue; }
    else if (c === "/" && text[i + 1] === "*") { const close = text.indexOf("*/", i + 2); i = close === -1 ? text.length : close + 2; continue; }
    else if (c === "\"") {
      i++;
      while (i < text.length && text[i] !== "\"" && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    i++;
  }
  return text.length;
}
