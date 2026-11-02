// Edits a LaTeX or Typst talk or poster at the editor cursor: a new slide or block from a layout, a speaker note on the current slide,
// and the talk's aspect ratio or the poster's size rewritten in the document class, the beamerposter options or `#set page`.
import type { DeckKind, DeckSize } from "./deckSizes.js";
import { readSourceDeckOutline, type SourceDeckItem } from "./sourceDeckOutline.js";
import { listSourceDeckShapes, type SourceDeckShape } from "./sourceDeckScaffold.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** The text after an edit and where the cursor goes. */
export interface SourceDeckChange { text: string; cursor: number }

export type SlideLayout = "bullets" | "two-columns" | "figure" | "equation" | "title";
export type BlockLayout = "text" | "figure" | "equation" | "list";

export const SLIDE_LAYOUTS: ReadonlyArray<{ id: SlideLayout; label: string }> = [
  { id: "bullets", label: "Title and bullets" },
  { id: "two-columns", label: "Two columns" },
  { id: "figure", label: "Figure" },
  { id: "equation", label: "Equation" },
  { id: "title", label: "Section title" },
];

export const BLOCK_LAYOUTS: ReadonlyArray<{ id: BlockLayout; label: string }> = [
  { id: "text", label: "Text block" },
  { id: "list", label: "List block" },
  { id: "figure", label: "Figure block" },
  { id: "equation", label: "Equation block" },
];

/** The marker the cursor lands on in a snippet. */
const CURSOR = "\u0000";

const LATEX_SLIDE_BODY: Record<SlideLayout, string> = {
  bullets: "  \\begin{itemize}\n    \\item First point\n    \\item Second point\n  \\end{itemize}",
  "two-columns": "  \\begin{columns}\n    \\column{0.5\\textwidth}\n      Left\n    \\column{0.5\\textwidth}\n      Right\n  \\end{columns}",
  figure: "  \\begin{center}\n    \\includegraphics[width=0.8\\linewidth]{figure}\n  \\end{center}",
  equation: "  \\[\n    E = mc^2\n  \\]",
  title: "  \\centering\\Large Section",
};

const TYPST_SLIDE_BODY: Record<SlideLayout, string> = {
  bullets: "- First point\n- Second point",
  "two-columns": "#grid(columns: (1fr, 1fr), gutter: 1cm,\n  [Left],\n  [Right],\n)",
  figure: "#align(center, image(\"figure.png\", width: 80%))",
  equation: "$ E = m c^2 $",
  title: "#align(center + horizon, text(size: 32pt)[Section])",
};

function slideSnippet(format: SourceDeckFormat, layout: SlideLayout, callStyle: boolean): string {
  if (format === "latex") return `\\begin{frame}{${CURSOR}Title}\n${LATEX_SLIDE_BODY[layout]}\n\\end{frame}\n`;
  const body = TYPST_SLIDE_BODY[layout];
  return callStyle ? `#slide[\n  == ${CURSOR}Title\n  ${body.replace(/\n/g, "\n  ")}\n]\n` : `== ${CURSOR}Title\n${body}\n`;
}

const place = (text: string, at: number, snippet: string): SourceDeckChange => {
  const marker = snippet.indexOf(CURSOR);
  const clean = snippet.replace(CURSOR, "");
  return { text: text.slice(0, at) + clean + text.slice(at), cursor: at + Math.max(marker, 0) };
};

/** The slide or block holding the offset: the last one starting at or before it. */
export function findItemAt(items: readonly SourceDeckItem[], offset: number): number {
  let found = -1;
  items.forEach((item, index) => { if (item.start <= offset) found = index; });
  return found;
}

const lineEndAfter = (text: string, offset: number): number => {
  const next = text.indexOf("\n", offset);
  return next === -1 ? text.length : next + 1;
};

/** A new slide of the layout after the slide at the cursor (before `\end{document}` when the cursor is above every slide in LaTeX). */
export function insertSourceSlide(format: SourceDeckFormat, text: string, cursor: number, layout: SlideLayout): SourceDeckChange {
  const slides = readSourceDeckOutline(format, "talk", text);
  const index = findItemAt(slides, cursor);
  const callStyle = format === "typst" && /^#(?:[a-z-]+\.)?(?:slide|polylux-slide)\b/m.test(text);
  let at: number;
  if (index >= 0) at = slides[index]!.end;
  else if (slides.length > 0) at = slides[0]!.start;
  else {
    const end = format === "latex" ? text.search(/\\end\s*\{document\}/) : -1;
    at = end >= 0 ? end : text.length;
  }
  const before = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
  const gap = format === "typst" && !callStyle ? "\n" : "";
  return place(text, at, `${before}${slideSnippet(format, layout, callStyle)}${gap}`);
}

/** The poster flavour a source is written in: tikzposter `\block`, LaTeX `block` environments, Typst column boxes, or Typst headings. */
function posterFlavor(format: SourceDeckFormat, text: string): "tikz" | "env" | "column-box" | "heading" {
  if (format === "typst") return /#column-box\b/.test(text) ? "column-box" : "heading";
  return /\\documentclass\s*(?:\[[^\]]*\])?\s*\{tikzposter\}/.test(text) || /\\block\s*\{/.test(text) ? "tikz" : "env";
}

const LATEX_BLOCK_BODY: Record<BlockLayout, string> = {
  text: "    Text of the block.",
  list: "    \\begin{itemize}\n      \\item First point\n      \\item Second point\n    \\end{itemize}",
  figure: "    \\begin{center}\n      \\includegraphics[width=0.9\\linewidth]{figure}\n    \\end{center}",
  equation: "    \\[ E = mc^2 \\]",
};

const TYPST_BLOCK_BODY: Record<BlockLayout, string> = {
  text: "Text of the block.",
  list: "- First point\n- Second point",
  figure: "#image(\"figure.png\", width: 100%)",
  equation: "$ E = m c^2 $",
};

/** A new block of the layout on the line after the cursor, written in the poster's own flavour. */
export function insertSourceBlock(format: SourceDeckFormat, text: string, cursor: number, layout: BlockLayout): SourceDeckChange {
  const at = lineEndAfter(text, cursor);
  const flavor = posterFlavor(format, text);
  const before = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
  const snippet = flavor === "tikz" ? `  \\block{${CURSOR}Title}{\n${LATEX_BLOCK_BODY[layout]}\n  }\n`
    : flavor === "env" ? `  \\begin{block}{${CURSOR}Title}\n${LATEX_BLOCK_BODY[layout]}\n  \\end{block}\n`
      : flavor === "column-box" ? `#column-box(heading: [${CURSOR}Title])[\n  ${TYPST_BLOCK_BODY[layout].replace(/\n/g, "\n  ")}\n]\n`
        : `\n= ${CURSOR}Title\n${TYPST_BLOCK_BODY[layout]}\n`;
  return place(text, at, before + snippet);
}

/** A speaker note at the end of the slide holding the cursor (before `\end{frame}` in LaTeX); null outside any slide. */
export function insertSourceNote(format: SourceDeckFormat, text: string, cursor: number): SourceDeckChange | null {
  const slides = readSourceDeckOutline(format, "talk", text);
  const slide = slides[findItemAt(slides, cursor)];
  if (!slide) return null;
  if (format === "latex") {
    const body = text.slice(slide.start, slide.end);
    const close = body.search(/\\end\s*\{frame\}/);
    if (close < 0) return null;
    const at = slide.start + close;
    return place(text, at, `  \\note{${CURSOR}}\n`);
  }
  const at = slide.end;
  const before = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
  return place(text, at, `${before}#speaker-note[${CURSOR}]\n`);
}

const DOCUMENT_CLASS = /\\documentclass\s*(\[[^\]]*\])?\s*\{([A-Za-z0-9-]+)\}/;
const BEAMERPOSTER = /\\usepackage\s*(\[[^\]]*\])?\s*\{beamerposter\}/;
const TYPST_PAGE = /#set\s+page\s*\(([^)]*)\)/;

/** Options `[a, b=c]` as a list, kept in order. */
const readOptions = (group: string | undefined): string[] => (group ? group.slice(1, -1).split(",").map((o) => o.trim()).filter(Boolean) : []);

/** The options with every one matching `drop` removed and `add` appended. */
const withOptions = (options: string[], drop: RegExp, add: string[]): string => `[${[...options.filter((o) => !drop.test(o)), ...add].join(", ")}]`;

const typstLength = (value: number, unit: DeckSize["unit"]): string => `${value}${unit === "in" ? "in" : "mm"}`;

function setTypstPage(text: string, width: string, height: string): string {
  const match = TYPST_PAGE.exec(text);
  if (!match) return `#set page(width: ${width}, height: ${height})\n${text}`;
  const args = match[1]!.split(",").map((a) => a.trim()).filter((a) => a && !/^(width|height|paper|flipped)\s*:/.test(a));
  const call = `#set page(${[`width: ${width}`, `height: ${height}`, ...args].join(", ")})`;
  return text.slice(0, match.index) + call + text.slice(match.index + match[0].length);
}

/** The text with the talk's aspect ratio or the poster's size changed; null when the source has no place LabShelf knows to write it. */
export function setSourceDeckShape(format: SourceDeckFormat, text: string, shape: SourceDeckShape): string | null {
  if (format === "typst") {
    if (shape.kind === "talk") return setTypstPage(text, "254mm", shape.aspect === "16:9" ? "142.88mm" : "190.5mm");
    return setTypstPage(text, typstLength(shape.size.w, shape.size.unit), typstLength(shape.size.h, shape.size.unit));
  }
  const documentClass = DOCUMENT_CLASS.exec(text);
  if (!documentClass) return null;
  const classOptions = readOptions(documentClass[1]);
  const writeClass = (options: string): string => text.slice(0, documentClass.index) + `\\documentclass${options}{${documentClass[2]}}` + text.slice(documentClass.index + documentClass[0].length);
  if (shape.kind === "talk") return writeClass(withOptions(classOptions, /^aspectratio\s*=/, [`aspectratio=${shape.aspect === "16:9" ? "169" : "43"}`]));
  const paper = shape.paper;
  if (!paper) return null;
  const orientation = shape.landscape ? "landscape" : "portrait";
  const poster = BEAMERPOSTER.exec(text);
  if (poster) {
    const options = withOptions(readOptions(poster[1]), /^(size|orientation)\s*=/, [`size=${paper}`, `orientation=${orientation}`]);
    return text.slice(0, poster.index) + `\\usepackage${options}{beamerposter}` + text.slice(poster.index + poster[0].length);
  }
  return writeClass(withOptions(classOptions, /^(a\dpaper|portrait|landscape)$/, [`${paper}paper`, orientation]));
}

const toMm = (value: number, unit: string): number => (unit === "in" ? value * 25.4 : unit === "cm" ? value * 10 : value);

/** The page of a Typst source in mm from its `#set page(width:, height:)`, or undefined. */
function readTypstPageMm(text: string): [number, number] | undefined {
  const args = TYPST_PAGE.exec(text)?.[1] ?? "";
  const width = /width\s*:\s*([\d.]+)\s*(mm|cm|in)/.exec(args);
  const height = /height\s*:\s*([\d.]+)\s*(mm|cm|in)/.exec(args);
  return width && height ? [toMm(Number(width[1]), width[2]!), toMm(Number(height[1]), height[2]!)] : undefined;
}

/** The label of the size choice the source is at now (as listSourceDeckShapes names it), or undefined when it matches none. */
export function readSourceDeckShape(format: SourceDeckFormat, kind: DeckKind, text: string): string | undefined {
  const choices = listSourceDeckShapes(kind, format);
  if (format === "typst") {
    const page = readTypstPageMm(text);
    if (!page) return undefined;
    const [w, h] = page;
    return choices.find(({ shape }) => (shape.kind === "talk"
      ? Math.abs(h / w - (shape.aspect === "16:9" ? 9 / 16 : 3 / 4)) < 0.01
      : Math.abs(toMm(shape.size.w, shape.size.unit) - w) < 1 && Math.abs(toMm(shape.size.h, shape.size.unit) - h) < 1))?.label;
  }
  const classOptions = readOptions(DOCUMENT_CLASS.exec(text)?.[1]);
  if (kind === "talk") {
    // Beamer's default aspect ratio is 4:3.
    const ratio = classOptions.find((o) => /^aspectratio\s*=/.test(o))?.split("=")[1]?.trim() ?? "43";
    return ratio === "169" ? "16:9" : ratio === "43" ? "4:3" : undefined;
  }
  const posterOptions = readOptions(BEAMERPOSTER.exec(text)?.[1]);
  const paper = posterOptions.find((o) => /^size\s*=/.test(o))?.split("=")[1]?.trim() ?? classOptions.find((o) => /^a\dpaper$/.test(o))?.slice(0, 2);
  const landscape = posterOptions.some((o) => /^orientation\s*=\s*landscape$/.test(o)) || classOptions.includes("landscape");
  return choices.find(({ shape }) => shape.kind === "poster" && shape.paper === paper && (shape.landscape === true) === landscape)?.label;
}
