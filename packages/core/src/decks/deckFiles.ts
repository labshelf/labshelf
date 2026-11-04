// Which files of a project are talks or posters, read from their content wherever they are: an HTML file in the deck format, or a LaTeX or Typst source a talk or poster class or package marks.
import { listProjectFiles, type ProjectReadContext } from "../writing/project/index.js";
import type { DeckKind } from "./deckSizes.js";
import { readSourceDeckKind } from "./sourceDecks.js";

/** A talk or poster file of a project; `path` is project-relative with "/" separators. */
export interface ProjectDeckFile { path: string; kind: DeckKind; format: "html" | "latex" | "typst" }

const HTML_DECK = /<html\b[^>]*\bdata-deck\s*=\s*["']?(talk|poster)\b/i;
const DECK_EXTENSION = /\.(html|tex|typ)$/i;

/** Whether an HTML file is a talk or a poster in the deck format: the `data-deck` attribute of its html element; null for any other page. */
export function detectHtmlDeckKind(text: string): DeckKind | null {
  const kind = HTML_DECK.exec(text)?.[1]?.toLowerCase();
  return kind === "talk" || kind === "poster" ? kind : null;
}

/** The kind of talk or poster a .html, .tex or .typ file is, from its text; undefined for any other file. */
export function readDeckFileKind(path: string, text: string): DeckKind | undefined {
  if (/\.html$/i.test(path)) return detectHtmlDeckKind(text) ?? undefined;
  return readSourceDeckKind(path, text);
}

/** Whether a path can hold a talk or poster (.html, .tex or .typ); the kind needs the text. */
export function isDeckFileCandidate(path: string): boolean {
  return DECK_EXTENSION.test(path);
}

/** The talks and posters of a project, every .html, .tex or .typ file whose content is one, by path; a file that cannot be read is skipped. */
export async function listProjectDeckFiles(context: Pick<ProjectReadContext, "fs" | "paths">, projectFolder: string): Promise<ProjectDeckFile[]> {
  const files = (await listProjectFiles(context, projectFolder)).filter(isDeckFileCandidate);
  const found = await Promise.all(files.map(async (path): Promise<ProjectDeckFile | undefined> => {
    let text: string;
    try {
      text = await context.fs.readText(context.paths.join(projectFolder, ...path.split("/")));
    } catch {
      return undefined;
    }
    const kind = readDeckFileKind(path, text);
    if (!kind) return undefined;
    const format = /\.html$/i.test(path) ? "html" : /\.typ$/i.test(path) ? "typst" : "latex";
    return { path, kind, format };
  }));
  return found.filter((file): file is ProjectDeckFile => file !== undefined);
}
