// Talks and posters written in LaTeX or Typst: which sources are one, the file a new one gets, and which slide each PDF page shows.
import { removeComments } from "../latex/index.js";
import type { DeckKind } from "./deckSizes.js";
import { readSourceDeckFrames } from "./sourceDeckFrames.js";
import { readSourceDeckNotes } from "./sourceDeckOutline.js";
import { TYPST_DECKS_ENABLED } from "./typstDecks.js";

export type SourceDeckFormat = "latex" | "typst";

const MARKER = /^[ \t]*(?:%|\/\/)[ \t]*labshelf:[ \t]*(talk|poster)\b/m;
const LATEX_POSTER_CLASSES = new Set(["tikzposter", "baposter", "a0poster", "sciposter", "tcbposter", "beamerposter"]);
const LATEX_POSTER_PACKAGES = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(beamerposter|tcbposter|baposter)\b[^}]*\}/;
const DOCUMENT_CLASS = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{\s*([A-Za-z0-9-]+)\s*\}/;
const TYPST_IMPORT = /#import\s+"@preview\/([a-z0-9-]+):/g;
const TYPST_TALK_PACKAGES = new Set(["touying", "polylux", "slydst", "minideck", "diatypst", "presentate", "typslides", "simple-slides", "slydst"]);
const TYPST_POSTER_PACKAGES = new Set(["peace-of-posters", "postercise", "typst-poster", "a0-poster", "better-poster", "nanoposter"]);

/** Whether a source format can hold a talk or poster: LaTeX always, Typst only while TYPST_DECKS_ENABLED. */
export function isSourceDeckFormatEnabled(format: SourceDeckFormat): boolean {
  return format === "latex" || TYPST_DECKS_ENABLED;
}

/** Whether a LaTeX or Typst source is a talk or a poster: a `labshelf: talk|poster` comment, else its document class, packages or Typst imports; null for any other document, and for every Typst source while Typst decks are off. */
export function detectSourceDeckKind(format: SourceDeckFormat, text: string): DeckKind | null {
  if (!isSourceDeckFormatEnabled(format)) return null;
  const marked = MARKER.exec(text)?.[1];
  if (marked === "talk" || marked === "poster") return marked;
  if (format === "latex") {
    const code = removeComments(text);
    const documentClass = DOCUMENT_CLASS.exec(code)?.[1];
    if (documentClass === undefined) return null;
    if (LATEX_POSTER_CLASSES.has(documentClass) || LATEX_POSTER_PACKAGES.test(code)) return "poster";
    return documentClass === "beamer" ? "talk" : null;
  }
  for (const match of text.matchAll(TYPST_IMPORT)) {
    const name = match[1]!;
    if (TYPST_POSTER_PACKAGES.has(name) || name.includes("poster")) return "poster";
    if (TYPST_TALK_PACKAGES.has(name) || /slide|present/.test(name)) return "talk";
  }
  return null;
}

const MAIN_FILE: Record<SourceDeckFormat, string> = { latex: "main.tex", typst: "main.typ" };

/** The file name a new source talk or poster gets in its folder. */
export function sourceDeckMainFile(format: SourceDeckFormat): string {
  return MAIN_FILE[format];
}

/**
 * The slide each PDF page shows. Beamer numbers the pages of a frame's overlays with the frame number as page label, so numeric labels
 * that never go down and stay within the slide count map pages to slides; otherwise one page is one slide when the counts match. null when
 * neither holds (the notes cannot be placed). `slides` is the slide count or the numbered frames (readSourceDeckFrames): then a label maps
 * through its frame, and a page of a null frame (a section divider) maps to -1; the count rules use the non-null frames.
 */
export function mapPagesToSlides(labels: readonly string[] | null, pages: number, slides: number | readonly (number | null)[]): number[] | null {
  const frames = typeof slides === "number" ? null : slides;
  const count = frames ? frames.filter((frame) => frame !== null).length : (slides as number);
  if (labels && labels.length === pages) {
    const numbers = labels.map((label) => Number.parseInt(label, 10));
    const limit = frames ? frames.length : count;
    const monotone = numbers.every((n, i) => Number.isInteger(n) && n >= 1 && n <= limit && (i === 0 || n >= numbers[i - 1]!));
    if (monotone && limit > 0) return numbers.map((n) => (frames ? frames[n - 1] ?? -1 : n - 1));
  }
  return pages === count ? Array.from({ length: pages }, (_, i) => i) : null;
}

/**
 * What a build root is as a talk or poster: its kind (from the source, else from a talks/ or posters/ folder) and, for a talk, the notes of
 * each slide and its numbered frames (readSourceDeckFrames). undefined for any other document, and for Typst while Typst decks are off.
 */
export function describeSourceDeck(format: SourceDeckFormat, root: string, text: string): { kind: DeckKind; notes?: string[]; frames?: Array<number | null> } | undefined {
  if (!isSourceDeckFormatEnabled(format)) return undefined;
  const folder = /^(talks|posters)\/[^/]+\/main\.(tex|typ)$/.exec(root)?.[1];
  const kind = detectSourceDeckKind(format, text) ?? (folder === "talks" ? "talk" : folder === "posters" ? "poster" : null);
  if (!kind) return undefined;
  return kind === "talk" ? { kind, notes: readSourceDeckNotes(format, text), frames: readSourceDeckFrames(format, text) } : { kind };
}

/** The kind of talk or poster a .tex or .typ file is, from its text or its talks/ or posters/ folder anywhere in `path`; undefined for any other file. */
export function readSourceDeckKind(path: string, text: string): DeckKind | undefined {
  if (!/\.(tex|typ)$/.test(path)) return undefined;
  const format: SourceDeckFormat = path.endsWith(".typ") ? "typst" : "latex";
  return describeSourceDeck(format, path.replace(/^.*?(?=(talks|posters)\/[^/]+\/main\.(tex|typ)$)/, ""), text)?.kind;
}
