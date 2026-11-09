// Talks and posters written in LaTeX or Typst: which sources are one, the file a new one gets, and which slide each PDF page shows.
import { removeComments, type DeckPageMap } from "../latex/index.js";
import type { DeckKind } from "./deckSizes.js";
import { readSourceDeckNotes, readSourceDeckOutline } from "./sourceDeckOutline.js";
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

const pageMaps = new Map<string, DeckPageMap>();

/**
 * Keeps the page map of a main file's last full build for this process (a host's project folder or project id as `project`, and the main
 * file's project-relative path), for Present, handouts and the preview's slide strip; a build without one forgets the old one.
 */
export function keepDeckPageMap(project: string, mainFile: string, map: DeckPageMap | undefined): void {
  if (map) pageMaps.set(`${project}\n${mainFile}`, map); else pageMaps.delete(`${project}\n${mainFile}`);
}

/** The page map of a main file's last full build kept by keepDeckPageMap; undefined when it was not built here. */
export function lastDeckPageMap(project: string, mainFile: string): DeckPageMap | undefined {
  return pageMaps.get(`${project}\n${mainFile}`);
}

/** A LaTeX talk's PDF pages read through its build's page map: each page's outline slide (-1 for none) and the source unit that shipped it. */
export interface TalkPages { slideOfPage: number[]; unitOfPage: string[] }

/**
 * The pages of a LaTeX talk from the page map of LabShelf's build of `mainFile` (a project-relative path) with text `text`. A page a frame
 * of that file shipped maps to the frame's place in the outline (the order its notes come in); any other page (a section divider, a frame of
 * an included file) to -1. Pages of one unit share its key, so a frame's overlays stay together. undefined without a map: nothing is linked.
 */
export function readTalkPages(map: DeckPageMap | undefined, mainFile: string, text: string): TalkPages | undefined {
  if (!map) return undefined;
  const name = mainFile.slice(mainFile.lastIndexOf("/") + 1);
  const lines = readSourceDeckOutline("latex", "talk", text).map((item) => item.line);
  return {
    slideOfPage: map.pages.map((unit) => (unit?.kind === "frame" && unit.file.replace(/^\.\//, "") === name ? lines.indexOf(unit.line) : -1)),
    unitOfPage: map.pages.map((unit, page) => (unit ? `${unit.kind}:${unit.file}:${unit.line}` : `page:${page}`)),
  };
}

/**
 * What a build root is as a talk or poster: its kind (from the source, else from a talks/ or posters/ folder) and, for a talk, the notes of
 * each slide. undefined for any other document, and for Typst while Typst decks are off.
 */
export function describeSourceDeck(format: SourceDeckFormat, root: string, text: string): { kind: DeckKind; notes?: string[] } | undefined {
  if (!isSourceDeckFormatEnabled(format)) return undefined;
  const folder = /^(talks|posters)\/[^/]+\/main\.(tex|typ)$/.exec(root)?.[1];
  const kind = detectSourceDeckKind(format, text) ?? (folder === "talks" ? "talk" : folder === "posters" ? "poster" : null);
  if (!kind) return undefined;
  return kind === "talk" ? { kind, notes: readSourceDeckNotes(format, text) } : { kind };
}

/** The kind of talk or poster a .tex or .typ file is, from its text or its talks/ or posters/ folder anywhere in `path`; undefined for any other file. */
export function readSourceDeckKind(path: string, text: string): DeckKind | undefined {
  if (!/\.(tex|typ)$/.test(path)) return undefined;
  const format: SourceDeckFormat = path.endsWith(".typ") ? "typst" : "latex";
  return describeSourceDeck(format, path.replace(/^.*?(?=(talks|posters)\/[^/]+\/main\.(tex|typ)$)/, ""), text)?.kind;
}
