/** Defines the one layout of a LabShelf library on disk: folder and file names, and every well-known path built from them.
 * Runtime-neutral; each app passes its own path type and join function. */

export const PAPERS_DIR = "papers";
export const RESEARCH_DIR = ".research";
export const APPDATA_DIR = "appdata";
export const PROJECTS_DIR = "projects";

export const PDF_FILE = "paper.pdf";
export const METADATA_FILE = "metadata.yaml";
export const BIB_FILE = "bib.bib";
export const SIDECAR_FILE = "data.json";

// Holds only the AI text index (embeddings and content hashes). The on-disk name stays "index.sqlite"
// so no existing file needs renaming.
export const AI_DATABASE_FILE = "index.sqlite";
export const APP_LOG_FILE = "app.log";
export const TERMINAL_LOG_FILE = "terminal.log";
export const PROJECT_REGISTRY_FILE = "projects.json";

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
  /** Device-local list of project folders that live outside the library. */
  projectRegistryPath(): T;
  researchRoot(): T;
  logsDir(): T;
  appLogPath(): T;
  terminalLogPath(): T;
  aiDatabasePath(): T;
  /** Scratch space for atomic writes: same volume as the library. */
  tmpDir(): T;
  /** OpenAlex citation data per paper and per cited work: device-local. */
  openAlexCacheDir(): T;
  paperDataRoot(): T;
  paperDataDir(paperId: string): T;
  paperDataPath(paperId: string): T;
  /** Folders a library needs. Creating them recursively, in order, yields the full structure. */
  requiredDirs(): T[];
  /** Folders whose presence marks a folder as a library. */
  markerDirs(): T[];
}

export function libraryLayout<T>(root: T, join: Join<T>): LibraryLayout<T> {
  const research = () => join(root, RESEARCH_DIR);
  const logsDir = () => join(research(), "logs");
  const paperDataRoot = () => join(research(), PAPERS_DIR);
  const paperDataDir = (paperId: string) => join(paperDataRoot(), paperId);
  return {
    root,
    papersRoot: () => join(root, PAPERS_DIR),
    projectsRoot: () => join(root, PROJECTS_DIR),
    projectRegistryPath: () => join(research(), PROJECT_REGISTRY_FILE),
    researchRoot: research,
    logsDir,
    appLogPath: () => join(logsDir(), APP_LOG_FILE),
    terminalLogPath: () => join(logsDir(), TERMINAL_LOG_FILE),
    aiDatabasePath: () => join(research(), AI_DATABASE_FILE),
    tmpDir: () => join(research(), "tmp"),
    openAlexCacheDir: () => join(research(), "openalex"),
    paperDataRoot,
    paperDataDir,
    paperDataPath: (paperId) => join(paperDataDir(paperId), SIDECAR_FILE),
    requiredDirs: () => [research(), logsDir(), paperDataRoot(), join(root, PAPERS_DIR)],
    markerDirs: () => [join(root, PAPERS_DIR), research()],
  };
}

export interface PaperFiles<T> { pdf: T; metadata: T; bib: T }

/** The files inside one paper folder. */
export function paperFiles<T>(folder: T, join: Join<T>): PaperFiles<T> {
  return { pdf: join(folder, PDF_FILE), metadata: join(folder, METADATA_FILE), bib: join(folder, BIB_FILE) };
}
