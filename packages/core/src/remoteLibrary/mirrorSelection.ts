/** What the Mirror holds: the papers index, the notes of kept papers, project sources, assets and settings, each deck's
 * single-file HTML, the Spaces, Home, compiled project PDFs and, when asked, the PDFs of kept papers, as library-relative
 * paths with a kind and a read() each (text kinds read strings, `output`, `asset` and `pdf` read bytes). Trashed papers,
 * conflict copies, hidden folders and build output are left out; a deck that fails to export or any file over 64 MiB is
 * listed in `skipped` and never fails the selection. */
import type { MirrorKind } from "./mirrorState.js";

export interface MirrorFile { path: string; kind: MirrorKind; read(): Promise<string | Uint8Array> }
export interface MirrorSelection { files: MirrorFile[]; skipped: { path: string; reason: string }[] }
export interface MirrorPaper { id: string; folder: string; trashed: boolean; record: unknown }
/** `fileSize` answers a listed file's byte size without reading it. */
export interface MirrorSelectionDeps {
  papers: MirrorPaper[];
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  fileSize(path: string): Promise<number>;
  exportDeck(deckHtmlPath: string): Promise<{ html: string }>;
}

/** The largest file of any kind the Mirror takes. */
export const MAX_MIRROR_FILE_BYTES = 64 * 1024 * 1024;
const PAPERS_INDEX = "index/papers.json";
const HOME = "home.json";
const SOURCE_EXTENSIONS = [".tex", ".typ", ".bib", ".qmd", ".sty", ".cls", ".bst", ".bbx", ".cbx", ".csv", ".txt", ".md", ".json"];
const ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".eps", ".pdf"];
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

const hasExtension = (path: string, extensions: string[]): boolean => extensions.some((extension) => path.toLowerCase().endsWith(extension));

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

const failure = (error: unknown, fallback: string): { reason: string } => ({ reason: error instanceof Error && error.message ? error.message : fallback });
const overCap = (bytes: number, what: string): { reason: string } => ({ reason: `${what} is ${bytes} bytes, over the 64 MiB limit.` });

async function deckFile(path: string, deps: MirrorSelectionDeps): Promise<MirrorFile | { reason: string }> {
  let html: string;
  try {
    ({ html } = await deps.exportDeck(path));
  } catch (error) {
    return failure(error, "The deck could not be exported.");
  }
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > MAX_MIRROR_FILE_BYTES) { return overCap(bytes, "The exported deck"); }
  return { path, kind: "deck", read: async () => html };
}

/** A file read as bytes, or the reason it is skipped: unreadable size or over the cap. */
async function binaryFile(path: string, kind: "output" | "asset" | "pdf", deps: MirrorSelectionDeps): Promise<MirrorFile | { reason: string }> {
  let size: number;
  try {
    size = await deps.fileSize(path);
  } catch (error) {
    return failure(error, "The file could not be read.");
  }
  if (size > MAX_MIRROR_FILE_BYTES) { return overCap(size, "The file"); }
  return { path, kind, read: () => deps.readBytes(path) };
}

function isSpaceFile(path: string): boolean {
  const match = /^spaces\/[^/]+\/(.+)$/.exec(path);
  return match !== null && SPACE_FILES.some((rule) => rule.test(match[1]!));
}

/** projects/<p>/labshelf.yaml, exactly at the project root. */
function isProjectSettings(path: string): boolean {
  return /^projects\/[^/]+\/labshelf\.yaml$/.test(path);
}

/** The listed `.pdf` files directly in a kept paper's folder, sorted. */
function paperPdfPaths(kept: MirrorPaper[], listed: string[]): string[] {
  const folders = new Set(kept.map((paper) => joinPath("papers", paper.folder, paper.id)));
  return listed.filter((path) => {
    if (excluded(path) || !path.toLowerCase().endsWith(".pdf")) { return false; }
    return folders.has(path.slice(0, path.lastIndexOf("/")));
  }).sort();
}

/** The kind a project file is mirrored as, or undefined when it is not mirrored. */
function projectKind(path: string, present: Set<string>): MirrorKind | undefined {
  if (path.endsWith("/deck.html")) { return "deck"; }
  if (path.toLowerCase().endsWith(".pdf")) {
    const stem = path.slice(0, -".pdf".length);
    return OUTPUT_SOURCE_EXTENSIONS.some((extension) => present.has(stem + extension)) ? "output" : "asset";
  }
  if (isProjectSettings(path) || hasExtension(path, SOURCE_EXTENSIONS)) { return "source"; }
  return hasExtension(path, ASSET_EXTENSIONS) ? "asset" : undefined;
}

export async function selectMirrorFiles(deps: MirrorSelectionDeps, options: { includePdfs: boolean }): Promise<MirrorSelection> {
  const kept = deps.papers.filter((paper) => !paper.trashed);
  const index = papersIndex(kept);
  const files: MirrorFile[] = [{ path: PAPERS_INDEX, kind: "papers", read: async () => index }];
  const skipped: MirrorSelection["skipped"] = [];
  const noteFiles = new Set(kept.map((paper) => joinPath("papers", paper.folder, paper.id, "notes.qmd")));
  const read = (path: string) => (): Promise<string> => deps.readText(path);
  const add = (path: string, file: MirrorFile | { reason: string }): void => {
    if ("reason" in file) { skipped.push({ path, reason: file.reason }); } else { files.push(file); }
  };

  const listed = [...await deps.listFiles()].sort();
  const present = new Set(listed);
  const paperPdfs = new Set(options.includePdfs ? paperPdfPaths(kept, listed) : []);

  for (const path of listed) {
    if (excluded(path)) { continue; }
    if (path === HOME) {
      files.push({ path, kind: "home", read: read(path) });
    } else if (path.startsWith("spaces/")) {
      if (isSpaceFile(path)) { files.push({ path, kind: "space", read: read(path) }); }
    } else if (path.startsWith("papers/")) {
      if (noteFiles.has(path)) { files.push({ path, kind: "notes", read: read(path) }); }
      if (paperPdfs.has(path)) { add(path, await binaryFile(path, "pdf", deps)); }
    } else if (path.startsWith("projects/")) {
      const kind = projectKind(path, present);
      if (kind === "deck") {
        add(path, await deckFile(path, deps));
      } else if (kind === "output" || kind === "asset") {
        add(path, await binaryFile(path, kind, deps));
      } else if (kind) {
        files.push({ path, kind, read: read(path) });
      }
    }
  }
  return { files, skipped };
}

/** What including paper PDFs would add: the byte sum and count of the PDFs directly in kept papers' folders. */
export async function estimatePaperPdfs(deps: MirrorSelectionDeps): Promise<{ bytes: number; files: number }> {
  const paths = paperPdfPaths(deps.papers.filter((paper) => !paper.trashed), await deps.listFiles());
  const sizes = await Promise.all(paths.map((path) => deps.fileSize(path)));
  return { bytes: sizes.reduce((sum, size) => sum + size, 0), files: paths.length };
}
