/** Defines the one layout of a LabShelf library folder: folder and file names, and every well-known path built from them,
 * and the config file LabShelf apps share on this computer: its shape, parsing, merging and serialization.
 * Runtime-neutral; each app passes its own path type and join function. Device-local files live in node/layout. */
import { isRecord } from "../guards/index.js";

export const PAPERS_DIR = "papers";
export const RESEARCH_DIR = ".research";
export const PROJECTS_DIR = "projects";
export const SPACES_DIR = "spaces";

export const PDF_FILE = "paper.pdf";
export const METADATA_FILE = "metadata.yaml";
export const BIB_FILE = "bib.bib";
export const SIDECAR_FILE = "data.json";
// CONTRACT: documents/contracts/library-format.md#layout
export const PAPER_NOTES_FILE = "notes.qmd";
// CONTRACT: documents/contracts/spaces.md#layout
export const SPACE_FILE = "space.json";
export const GLOSSARY_FILE = "glossary.json";
// CONTRACT: documents/contracts/library-format.md#reader-themes
export const READER_THEMES_FILE = "reader-themes.json";

export type Join<T> = (base: T, ...segments: string[]) => T;

/** String join with a fixed separator. Empty parts are skipped, so an empty root yields relative keys. */
export function joinWith(sep: "/" | "\\"): Join<string> {
  return (base, ...segments) => [base, ...segments].filter((part) => part !== "").join(sep);
}

export interface LibraryLayout<T> {
  readonly root: T;
  papersRoot(): T;
  /** Writing projects created by LabShelf, one folder each. */
  projectsRoot(): T;
  /** One folder per Space, named by its space id. */
  spacesRoot(): T;
  spaceDir(spaceId: string): T;
  spaceFilePath(spaceId: string): T;
  glossaryFilePath(spaceId: string): T;
  researchRoot(): T;
  /** Scratch space for atomic writes: same volume as the library. */
  tmpDir(): T;
  paperDataRoot(): T;
  paperDataDir(paperId: string): T;
  paperDataPath(paperId: string): T;
  /** The paper's notes.qmd, beside its data.json. */
  paperNotesPath(paperId: string): T;
  /** The user's custom reader themes, shared by every paper and app. */
  readerThemesPath(): T;
  /** Folders a library needs. Creating them recursively, in order, yields the full structure. */
  requiredDirs(): T[];
  /** Folders whose presence marks a folder as a library. */
  markerDirs(): T[];
}

export function createLibraryLayout<T>(root: T, join: Join<T>): LibraryLayout<T> {
  const research = () => join(root, RESEARCH_DIR);
  const paperDataRoot = () => join(research(), PAPERS_DIR);
  const paperDataDir = (paperId: string) => join(paperDataRoot(), paperId);
  const spaceDir = (spaceId: string) => join(root, SPACES_DIR, spaceId);
  return {
    root,
    papersRoot: () => join(root, PAPERS_DIR),
    projectsRoot: () => join(root, PROJECTS_DIR),
    spacesRoot: () => join(root, SPACES_DIR),
    spaceDir,
    spaceFilePath: (spaceId) => join(spaceDir(spaceId), SPACE_FILE),
    glossaryFilePath: (spaceId) => join(spaceDir(spaceId), GLOSSARY_FILE),
    researchRoot: research,
    tmpDir: () => join(research(), "tmp"),
    paperDataRoot,
    paperDataDir,
    paperDataPath: (paperId) => join(paperDataDir(paperId), SIDECAR_FILE),
    paperNotesPath: (paperId) => join(paperDataDir(paperId), PAPER_NOTES_FILE),
    readerThemesPath: () => join(research(), READER_THEMES_FILE),
    requiredDirs: () => [research(), paperDataRoot(), join(root, PAPERS_DIR)],
    markerDirs: () => [join(root, PAPERS_DIR), research()],
  };
}

export interface PaperFiles<T> { pdf: T; metadata: T; bib: T }

/** The files inside one paper folder. */
export function createPaperFiles<T>(folder: T, join: Join<T>): PaperFiles<T> {
  return { pdf: join(folder, PDF_FILE), metadata: join(folder, METADATA_FILE), bib: join(folder, BIB_FILE) };
}

export const SHARED_CONFIG_VERSION = 1;

/** Every app owns its own namespace key (e.g. "terminal") and keeps the keys it does not know. */
export interface SharedConfig {
  version: 1;
  libraryRoot?: string;
  [namespace: string]: unknown;
}

/** A change to apply: a key set to undefined is removed. */
export interface SharedConfigUpdate {
  libraryRoot?: string | undefined;
  [namespace: string]: unknown;
}

/**
 * Parses the file text; anything that is not a JSON object reads as an empty config.
 * @returns the config, with every key the file holds and version forced to 1
 */
export function parseSharedConfig(text: string): SharedConfig {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) { return { ...parsed, version: SHARED_CONFIG_VERSION }; }
  } catch {
    // A corrupt file reads as empty; the next update rewrites it.
  }
  return { version: SHARED_CONFIG_VERSION };
}

/**
 * Applies a patch: a key whose current and patched values are both objects merges one level deep, so an app
 * updating one preference keeps the others; a key patched to undefined is removed.
 * @returns the merged config
 */
export function mergeSharedConfig(current: SharedConfig, patch: SharedConfigUpdate): SharedConfig {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else if (isRecord(value) && isRecord(current[key])) {
      next[key] = { ...current[key], ...value };
    } else {
      next[key] = value;
    }
  }
  return { ...next, version: SHARED_CONFIG_VERSION };
}

/** @returns the file text: indented JSON with a trailing newline */
export function serializeSharedConfig(config: SharedConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}
