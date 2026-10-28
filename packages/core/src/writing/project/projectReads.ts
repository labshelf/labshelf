/** Reads project folders through the file-system port: one project, the library's list, file listings, edit times, the papers key of labshelf.yaml, the .bib files a main file loads, and the host's open editors. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import { createLibraryLayout } from "../../library/index.js";
import type { PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import { readProjectEntry, type ProjectEntry, type ProjectFolderReader, type ProjectPlacement } from "./projectEntry.js";
import { PROJECT_FILE, parseProjectFile } from "./projectFile.js";

// --- Reading a project folder ---

/** What reading project folders runs over: the file-system port, path arithmetic and the logger. */
export interface ProjectReadContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  logger: ILogger;
}

const SOURCE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".sty", ".cls", ".yaml"]);

/** Reads a text file through the file-system port, treating anything that is not a file as absent. */
export async function readOptionalText(fs: LibraryFileSystem, file: string): Promise<string | undefined> {
  return (await fs.stat(file))?.isFile ? fs.readText(file) : undefined;
}

/** Paths of every file under the folder relative to it, "/"-separated and sorted; hidden folders and node_modules hold no project sources. */
export async function listProjectFiles({ fs, paths }: Pick<ProjectReadContext, "fs" | "paths">, folder: string): Promise<string[]> {
  // The port lists a missing folder as empty; a project folder that is gone must fail so callers log and skip it.
  if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder}: project folder not found`); }
  const files: string[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const name of await fs.listDir(dir)) {
      const full = paths.join(dir, name);
      const stat = await fs.stat(full);
      if (stat?.isDirectory && !name.startsWith(".") && name !== "node_modules") { await visit(full, `${prefix}${name}/`); }
      if (stat?.isFile) { files.push(`${prefix}${name}`); }
    }
  };
  await visit(folder, "");
  return files.sort();
}

/** @returns the newest mtime in ms among the source files, or undefined when there are none */
export async function readLastModified(context: Pick<ProjectReadContext, "fs" | "paths">, folder: string): Promise<number | undefined> {
  const { fs, paths } = context;
  const sources = (await listProjectFiles(context, folder)).filter((file) => SOURCE_EXTENSIONS.has(paths.extname(file).toLowerCase()));
  const times = await Promise.all(sources.map(async (file) => (await fs.stat(paths.join(folder, file)))?.mtimeMs ?? 0));
  return times.length === 0 ? undefined : Math.max(...times);
}

/** The names in the folder with their kind; a name that vanishes between the listing and its stat is dropped. */
export async function listDirEntries({ fs, paths }: Pick<ProjectReadContext, "fs" | "paths">, dir: string): Promise<{ name: string; folder: boolean; file: boolean }[]> {
  const names = await fs.listDir(dir);
  const stats = await Promise.all(names.map((name) => fs.stat(paths.join(dir, name))));
  return names.flatMap((name, index) => {
    const stat = stats[index];
    return stat ? [{ name, folder: stat.isDirectory, file: stat.isFile }] : [];
  });
}

/** Names of the files at the folder's root; sources in subfolders are not main candidates. */
export async function listBuildRootFileNames(context: Pick<ProjectReadContext, "fs" | "paths">, folder: string): Promise<string[]> {
  return (await listDirEntries(context, folder)).filter((entry) => entry.file).map((entry) => entry.name);
}

/** Reads the folder through the port; see readProjectEntry for how a project that cannot be read is returned. */
export function readProject(context: ProjectReadContext, folder: string, location: ProjectPlacement): Promise<ProjectEntry> {
  const { fs, paths, logger } = context;
  const reader: ProjectFolderReader = {
    readOptionalText: (name) => readOptionalText(fs, paths.join(folder, name)),
    rootFileNames: () => listBuildRootFileNames(context, folder),
    exists: async () => (await fs.stat(folder))?.isDirectory === true,
  };
  return readProjectEntry({ folder, location, reader, logger });
}

// --- Listing the library's projects ---

/** Visible folders inside projects/; a missing projects folder lists as empty. */
async function libraryProjectFolders({ fs, paths }: ProjectReadContext, libraryRoot: string): Promise<string[]> {
  const root = createLibraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot();
  const folders = (await fs.listDir(root)).filter((name) => !name.startsWith(".")).map((name) => paths.join(root, name));
  const stats = await Promise.all(folders.map((folder) => fs.stat(folder)));
  return folders.filter((_, index) => stats[index]?.isDirectory === true);
}

/** The library's own projects, then the registered folders in the order they were added. */
export async function listProjects(
  context: ProjectReadContext, libraryRoot: string, registeredFolders: readonly string[],
): Promise<ProjectEntry[]> {
  const own = await Promise.all((await libraryProjectFolders(context, libraryRoot)).map((folder) => readProject(context, folder, "library")));
  const external = await Promise.all(registeredFolders.map((folder) => readProject(context, folder, "external")));
  return [...own, ...external];
}

/** Reads only each labshelf.yaml; a file system failure is thrown, a missing or unparseable yaml never matches. */
export async function findLibraryProjectFolder(context: ProjectReadContext, libraryRoot: string, id: string): Promise<string | undefined> {
  for (const folder of await libraryProjectFolders(context, libraryRoot)) {
    const text = await readOptionalText(context.fs, context.paths.join(folder, PROJECT_FILE));
    const parsed = text === undefined ? undefined : parseProjectFile(text);
    if (parsed?.ok && parsed.settings.id === id) { return folder; }
  }
  return undefined;
}

// --- Bibliography files of a main file ---

const BIBLIOGRAPHY_COMMAND = /\\(bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]*)\}/g;
const COMMENT = /(^|[^\\])%.*$/gm;

/** Lists the .bib files a LaTeX main file loads; `generated` is the project's generated bibliography path, which is never a user file. */
export function listBibliographyFiles(mainText: string, generated: string): string[] {
  const code = mainText.replace(COMMENT, "$1");
  const paths = [...code.matchAll(BIBLIOGRAPHY_COMMAND)].flatMap((match) =>
    match[2]!.split(",").map((name) => name.trim()).filter(Boolean)
      .map((name) => (match[1] === "bibliography" && !name.endsWith(".bib") ? `${name}.bib` : name)));
  return [...new Set(paths)].filter((path) => path !== generated);
}

// --- Open editors ---

/** The host's open editors, whose unsaved text wins over the disk when reading a project's sources. */
export interface OpenSources {
  /** The text of an open document, or undefined when the file is not open. */
  text(file: string): string | undefined;
  /** Replaces the whole text of an open document; false when the file is not open. */
  replace(file: string, text: string): Promise<boolean>;
}
