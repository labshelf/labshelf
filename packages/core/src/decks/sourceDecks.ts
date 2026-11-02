// Talks and posters written in LaTeX or Typst: which sources are one, where they live in a project, and which slide each PDF page shows.
import { removeComments } from "../latex/index.js";
import type { ProjectReadContext } from "../writing/project/index.js";
import type { DeckKind } from "./deckSizes.js";
import { deckRootOf, isDeckName } from "./deckProject.js";
import { readSourceDeckNotes } from "./sourceDeckOutline.js";

export type SourceDeckFormat = "latex" | "typst";

/** A talk or poster written as source. `file` is project-relative; `folder` is "" for the project's own main file. */
export interface SourceDeckEntry { kind: DeckKind; name: string; folder: string; file: string; format: SourceDeckFormat }

const MARKER = /^[ \t]*(?:%|\/\/)[ \t]*labshelf:[ \t]*(talk|poster)\b/m;
const LATEX_POSTER_CLASSES = new Set(["tikzposter", "baposter", "a0poster", "sciposter", "tcbposter", "beamerposter"]);
const LATEX_POSTER_PACKAGES = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(beamerposter|tcbposter|baposter)\b[^}]*\}/;
const DOCUMENT_CLASS = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{\s*([A-Za-z0-9-]+)\s*\}/;
const TYPST_IMPORT = /#import\s+"@preview\/([a-z0-9-]+):/g;
const TYPST_TALK_PACKAGES = new Set(["touying", "polylux", "slydst", "minideck", "diatypst", "presentate", "typslides", "simple-slides", "slydst"]);
const TYPST_POSTER_PACKAGES = new Set(["peace-of-posters", "postercise", "typst-poster", "a0-poster", "better-poster", "nanoposter"]);

/** Whether a LaTeX or Typst source is a talk or a poster: a `labshelf: talk|poster` comment, else its document class, packages or Typst imports; null for any other document. */
export function detectSourceDeckKind(format: SourceDeckFormat, text: string): DeckKind | null {
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

async function readTextOrNull(context: Pick<ProjectReadContext, "fs">, path: string): Promise<string | null> {
  try {
    return await context.fs.readText(path);
  } catch {
    return null;
  }
}

/**
 * The source talks and posters of a project: its main file when that is one, and each `talks/<name>/` or `posters/<name>/` folder without a
 * deck.html that holds the project format's main file (main.tex or main.typ). Folders are listed by name.
 */
export async function listSourceDecks(context: Pick<ProjectReadContext, "fs" | "paths">, projectFolder: string, project: { main: string; format: SourceDeckFormat }): Promise<SourceDeckEntry[]> {
  const decks: SourceDeckEntry[] = [];
  const mainText = project.main ? await readTextOrNull(context, context.paths.join(projectFolder, ...project.main.split("/"))) : null;
  const mainKind = mainText === null ? null : detectSourceDeckKind(project.format, mainText);
  if (mainKind) decks.push({ kind: mainKind, name: project.main.split("/").pop() ?? project.main, folder: "", file: project.main, format: project.format });
  const fileName = MAIN_FILE[project.format];
  for (const kind of ["talk", "poster"] as const) {
    const root = deckRootOf(kind);
    let names: string[] = [];
    try {
      names = await context.fs.listDir(context.paths.join(projectFolder, root));
    } catch {
      continue;
    }
    for (const name of names.filter(isDeckName).sort()) {
      const folder = context.paths.join(projectFolder, root, name);
      if ((await context.fs.stat(context.paths.join(folder, "deck.html")))?.isFile) continue;
      if ((await context.fs.stat(context.paths.join(folder, fileName)))?.isFile !== true) continue;
      decks.push({ kind, name, folder: `${root}/${name}`, file: `${root}/${name}/${fileName}`, format: project.format });
    }
  }
  return decks;
}

/**
 * The slide each PDF page shows. Beamer numbers the pages of a frame's overlays with the frame number as page label, so numeric labels
 * that never go down and stay within the slide count map pages to slides; otherwise one page is one slide when the counts match. null when
 * neither holds (the notes cannot be placed).
 */
export function mapPagesToSlides(labels: readonly string[] | null, pages: number, slides: number): number[] | null {
  if (labels && labels.length === pages) {
    const numbers = labels.map((label) => Number.parseInt(label, 10));
    const monotone = numbers.every((n, i) => Number.isInteger(n) && n >= 1 && n <= slides && (i === 0 || n >= numbers[i - 1]!));
    if (monotone && slides > 0) return numbers.map((n) => n - 1);
  }
  return pages === slides ? Array.from({ length: pages }, (_, i) => i) : null;
}

/**
 * What a build root is as a talk or poster: its kind (from the source, else from a talks/ or posters/ folder) and, for a talk, the notes of
 * each slide. undefined for any other document.
 */
export function describeSourceDeck(format: SourceDeckFormat, root: string, text: string): { kind: DeckKind; notes?: string[] } | undefined {
  const folder = /^(talks|posters)\/[^/]+\/main\.(tex|typ)$/.exec(root)?.[1];
  const kind = detectSourceDeckKind(format, text) ?? (folder === "talks" ? "talk" : folder === "posters" ? "poster" : null);
  if (!kind) return undefined;
  return kind === "talk" ? { kind, notes: readSourceDeckNotes(format, text) } : { kind };
}
