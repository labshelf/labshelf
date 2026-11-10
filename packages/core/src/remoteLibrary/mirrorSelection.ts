/** What the Mirror holds: the papers index, the notes of kept papers, project sources and each deck's single-file HTML, as
 * library-relative paths with a kind and a read() each. Trashed papers, conflict copies, hidden folders, build output and
 * PDFs are left out; a deck that fails to export or is over 20 MiB is listed in `skipped` and never fails the selection. */
import type { MirrorRow } from "./mirrorState.js";

export interface MirrorFile { path: string; kind: MirrorRow["kind"]; read(): Promise<string> }
export interface MirrorSelection { files: MirrorFile[]; skipped: { path: string; reason: string }[] }
export interface MirrorPaper { id: string; folder: string; trashed: boolean; record: unknown }
export interface MirrorSelectionDeps { papers: MirrorPaper[]; listFiles(): Promise<string[]>; readText(path: string): Promise<string>; exportDeck(deckHtmlPath: string): Promise<{ html: string }> }

const MAX_DECK_BYTES = 20 * 1024 * 1024;
const PAPERS_INDEX = "index/papers.json";
const SOURCE_EXTENSIONS = [".tex", ".typ", ".bib", ".qmd"];

function excluded(path: string): boolean {
  if (path.endsWith(".pdf") || path.includes(".labshelf-conflict-")) { return true; }
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

export async function selectMirrorFiles(deps: MirrorSelectionDeps): Promise<MirrorSelection> {
  const kept = deps.papers.filter((paper) => !paper.trashed);
  const index = papersIndex(kept);
  const files: MirrorFile[] = [{ path: PAPERS_INDEX, kind: "papers", read: async () => index }];
  const skipped: MirrorSelection["skipped"] = [];
  const noteFiles = new Set(kept.map((paper) => joinPath("papers", paper.folder, paper.id, "notes.qmd")));
  const read = (path: string) => (): Promise<string> => deps.readText(path);

  for (const path of [...await deps.listFiles()].sort()) {
    if (excluded(path)) { continue; }
    if (path.startsWith("papers/")) {
      if (noteFiles.has(path)) { files.push({ path, kind: "notes", read: read(path) }); }
    } else if (path.startsWith("projects/")) {
      if (path.endsWith("/deck.html")) {
        const deck = await deckFile(path, deps);
        if ("reason" in deck) { skipped.push({ path, reason: deck.reason }); } else { files.push(deck); }
      } else if (SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) {
        files.push({ path, kind: "source", read: read(path) });
      }
    }
  }
  return { files, skipped };
}
