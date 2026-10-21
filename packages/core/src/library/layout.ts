/** Defines the one layout of a LabShelf library folder: folder and file names, and every well-known path built from them.
 * Runtime-neutral; each app passes its own path type and join function. Device-local files live in node/deviceState. */

export const PAPERS_DIR = "papers";
export const RESEARCH_DIR = ".research";
export const PROJECTS_DIR = "projects";
export const SPACES_DIR = "spaces";

export const PDF_FILE = "paper.pdf";
export const METADATA_FILE = "metadata.yaml";
export const BIB_FILE = "bib.bib";
export const SIDECAR_FILE = "data.json";
// CONTRACT: documents/contracts/spaces.md#layout
export const SPACE_FILE = "space.json";
export const GLOSSARY_FILE = "glossary.json";

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
  /** Folders a library needs. Creating them recursively, in order, yields the full structure. */
  requiredDirs(): T[];
  /** Folders whose presence marks a folder as a library. */
  markerDirs(): T[];
}

export function libraryLayout<T>(root: T, join: Join<T>): LibraryLayout<T> {
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
    requiredDirs: () => [research(), paperDataRoot(), join(root, PAPERS_DIR)],
    markerDirs: () => [join(root, PAPERS_DIR), research()],
  };
}

export interface PaperFiles<T> { pdf: T; metadata: T; bib: T }

/** The files inside one paper folder. */
export function paperFiles<T>(folder: T, join: Join<T>): PaperFiles<T> {
  return { pdf: join(folder, PDF_FILE), metadata: join(folder, METADATA_FILE), bib: join(folder, BIB_FILE) };
}
