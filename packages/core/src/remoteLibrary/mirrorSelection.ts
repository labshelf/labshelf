/** What the Mirror holds: the papers index, the notes of kept papers, project sources and settings, each deck's single-file
 * HTML, the Spaces, Home and compiled project PDFs (in parts, see mirrorOutput.ts), as library-relative paths with a kind and
 * a read() each. Trashed papers, conflict copies, hidden folders, build output and every other PDF are left out; a deck or an
 * output that fails to read or is over 20 MiB is listed in `skipped` and never fails the selection. */
import { encodeMirrorOutput, MAX_OUTPUT_BYTES, mirrorOutputPartPath } from "./mirrorOutput.js";
import type { MirrorRow } from "./mirrorState.js";

export interface MirrorFile { path: string; kind: MirrorRow["kind"]; read(): Promise<string> }
export interface MirrorSelection { files: MirrorFile[]; skipped: { path: string; reason: string }[] }
export interface MirrorPaper { id: string; folder: string; trashed: boolean; record: unknown }
export interface MirrorSelectionDeps { papers: MirrorPaper[]; listFiles(): Promise<string[]>; readText(path: string): Promise<string>; readBytes(path: string): Promise<Uint8Array>; exportDeck(deckHtmlPath: string): Promise<{ html: string }> }

const MAX_DECK_BYTES = 20 * 1024 * 1024;
const PAPERS_INDEX = "index/papers.json";
const HOME = "home.json";
const SOURCE_EXTENSIONS = [".tex", ".typ", ".bib", ".qmd"];
const OUTPUT_SOURCE_EXTENSIONS = [".tex", ".typ"];
/** Files of one Space, relative to `spaces/<id>/`. */
const SPACE_FILES = [/^space\.json$/, /^glossary\.json$/, /^notes\/[^/]+\.qmd$/, /^discussions\/[^/]+\.qmd$/, /^notes\/assets\/[^/]+\.csv$/];

function excluded(path: string): boolean {
  if (path.includes(".labshelf-conflict-")) { return true; }
  return path.split("/").some((segment) => segment.startsWith(".") || segment === "build" || segment === "_output");
}

function joinPath(...parts: string[]): string {
  return parts.filter((part) => part !== "").join("/");
}

/** Every non-empty folder path of the kept papers and their parents, sorted. */
function folderTree(papers: MirrorPaper[]): string[] {
  const folders = new Set<string>();
  for (const paper of papers) {
    const segments = paper.folder.split("/").filter((segment) => segment !== "");
    for (let end = 1; end <= segments.length; end += 1) { folders.add(segments.slice(0, end).join("/")); }
  }
  return [...folders].sort();
}

function papersIndex(papers: MirrorPaper[]): string {
  const index = { version: 1, folders: folderTree(papers), papers: papers.map(({ id, folder, record }) => ({ id, folder, record })) };
  return `${JSON.stringify(index, null, 2)}\n`;
}

async function deckFile(path: string, deps: MirrorSelectionDeps): Promise<MirrorFile | { reason: string }> {
  let html: string;
  try {
    ({ html } = await deps.exportDeck(path));
  } catch (error) {
    return { reason: error instanceof Error && error.message ? error.message : "The deck could not be exported." };
  }
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > MAX_DECK_BYTES) { return { reason: `The exported deck is ${bytes} bytes, over the 20 MiB limit.` }; }
  return { path, kind: "deck", read: async () => html };
}

function isSpaceFile(path: string): boolean {
  const match = /^spaces\/[^/]+\/(.+)$/.exec(path);
  return match !== null && SPACE_FILES.some((rule) => rule.test(match[1]!));
}

/** projects/<p>/labshelf.yaml, exactly at the project root. */
function isProjectSettings(path: string): boolean {
  return /^projects\/[^/]+\/labshelf\.yaml$/.test(path);
}

/** One row per part of a compiled output, or the reason it is skipped. */
async function outputFiles(path: string, deps: MirrorSelectionDeps): Promise<MirrorFile[] | { reason: string }> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.readBytes(path);
  } catch (error) {
    return { reason: error instanceof Error && error.message ? error.message : "The compiled output could not be read." };
  }
  if (bytes.byteLength > MAX_OUTPUT_BYTES) { return { reason: `The compiled output is ${bytes.byteLength} bytes, over the 20 MiB limit.` }; }
  const output = await encodeMirrorOutput(bytes);
  return Array.from({ length: output.parts }, (_, part): MirrorFile => ({
    path: mirrorOutputPartPath(path, part), kind: "output", read: async () => output.part(part),
  }));
}

export async function selectMirrorFiles(deps: MirrorSelectionDeps): Promise<MirrorSelection> {
  const kept = deps.papers.filter((paper) => !paper.trashed);
  const index = papersIndex(kept);
  const files: MirrorFile[] = [{ path: PAPERS_INDEX, kind: "papers", read: async () => index }];
  const skipped: MirrorSelection["skipped"] = [];
  const noteFiles = new Set(kept.map((paper) => joinPath("papers", paper.folder, paper.id, "notes.qmd")));
  const read = (path: string) => (): Promise<string> => deps.readText(path);

  const listed = [...await deps.listFiles()].sort();
  const present = new Set(listed);

  for (const path of listed) {
    if (excluded(path)) { continue; }
    if (path === HOME) {
      files.push({ path, kind: "home", read: read(path) });
    } else if (path.startsWith("spaces/")) {
      if (isSpaceFile(path)) { files.push({ path, kind: "space", read: read(path) }); }
    } else if (path.startsWith("papers/")) {
      if (noteFiles.has(path)) { files.push({ path, kind: "notes", read: read(path) }); }
    } else if (path.startsWith("projects/")) {
      if (path.endsWith("/deck.html")) {
        const deck = await deckFile(path, deps);
        if ("reason" in deck) { skipped.push({ path, reason: deck.reason }); } else { files.push(deck); }
      } else if (path.endsWith(".pdf")) {
        const stem = path.slice(0, -".pdf".length);
        if (!OUTPUT_SOURCE_EXTENSIONS.some((extension) => present.has(stem + extension))) { continue; }
        const output = await outputFiles(path, deps);
        if ("reason" in output) { skipped.push({ path, reason: output.reason }); } else { files.push(...output); }
      } else if (isProjectSettings(path) || SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
        files.push({ path, kind: "source", read: read(path) });
      }
    }
  }
  return { files, skipped };
}
