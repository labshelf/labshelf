/** Lists the user's own templates from <library>/templates and reads their files. */
// CONTRACT: documents/contracts/templates.md#my-templates
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { PathOps } from "../../library/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { parseTemplateManifest, deriveTemplatePathProblem, deriveTemplateTreeProblem } from "../templateManifest/index.js";
import type { TemplateFile, TemplateListing, TemplateSource } from "../sources/index.js";
import { readOptionalBytes } from "./readOptionalBytes.js";

interface LibraryFile {
  /** Relative to the walked folder, segments joined by `/`. */
  path: string;
  absolute: string;
  size: number;
}

// TRAP: a library stat reports a symbolic link as neither file nor folder, so this walk is the only guard between a tree and the files it points at.
async function walk(fs: LibraryFileSystem, paths: PathOps, directory: string, relative: string, found: LibraryFile[]): Promise<void> {
  for (const name of await fs.listDir(directory)) {
    const rel = relative === "" ? name : `${relative}/${name}`;
    const absolute = paths.join(directory, name);
    const stat = await fs.stat(absolute);
    if (stat?.isDirectory === true) { await walk(fs, paths, absolute, rel, found); continue; }
    if (stat?.isFile !== true) { throw new Error(`"${rel}" is not a regular file`); }
    found.push({ path: rel, absolute, size: stat.size });
  }
}

/** The folder's files sorted by relative path; throws naming the path of the first symbolic link or special file. */
async function walkLibraryFolder(fs: LibraryFileSystem, paths: PathOps, folder: string): Promise<LibraryFile[]> {
  if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder} is not a folder`); }
  const found: LibraryFile[] = [];
  await walk(fs, paths, folder, "", found);
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The folder's files sorted by their `/`-joined relative path; throws naming the path of the first one that breaks a rule. */
async function readLibraryTemplateTree(fs: LibraryFileSystem, paths: PathOps, folder: string): Promise<TemplateFile[]> {
  const found = await walkLibraryFolder(fs, paths, folder);
  const problem = deriveTemplateTreeProblem(found);
  if (problem !== undefined) { throw new Error(problem); }
  return Promise.all(found.map(async (file) => ({ path: file.path, bytes: await fs.readFile(file.absolute) })));
}

const MODULE = "templates";

export interface MineSourceDeps {
  fs: LibraryFileSystem;
  paths: PathOps;
  libraryRoot: string;
  logger: ILogger;
}

export function createMineSource({ fs, paths, libraryRoot, logger }: MineSourceDeps): TemplateSource {
  const templatesDir = paths.join(libraryRoot, "templates");

  async function listFilePaths(folder: string): Promise<string[] | undefined> {
    if (await fs.stat(folder) === undefined) { return undefined; }
    try {
      return (await walkLibraryFolder(fs, paths, folder)).map((file) => file.path);
    } catch (error) {
      await logger.error(MODULE, error, { action: "list My template files", folder });
      return undefined;
    }
  }

  async function readEntry(folderName: string): Promise<TemplateEntry | undefined> {
    const bytes = await readOptionalBytes(fs, paths.join(templatesDir, folderName, "template.yaml"));
    if (bytes === undefined) { return undefined; }
    const parsed = parseTemplateManifest(new TextDecoder().decode(bytes));
    const reason = !parsed.ok ? parsed.reason : parsed.manifest.id !== folderName ? `id "${parsed.manifest.id}" differs from the folder name` : undefined;
    if (!parsed.ok || reason !== undefined) {
      await logger.error(MODULE, new Error(`My template left out: ${reason}`), { folder: folderName });
      return undefined;
    }
    const files = await listFilePaths(paths.join(templatesDir, folderName, "files"));
    return { ...parsed.manifest, source: "mine", ...(files === undefined ? {} : { files }) };
  }

  // The id becomes a folder name, so anything but a plain segment could leave <library>/templates.
  const plainId = (id: string): boolean => !id.includes("/") && deriveTemplatePathProblem(id) === undefined;

  return {
    id: "mine",
    async list(): Promise<TemplateListing> {
      const entries: TemplateEntry[] = [];
      for (const name of (await fs.listDir(templatesDir)).sort()) {
        const entry = await readEntry(name);
        if (entry !== undefined) { entries.push(entry); }
      }
      return { entries, fromCache: false };
    },
    async thumbnail(entry: TemplateEntry): Promise<Uint8Array | undefined> {
      if (!plainId(entry.id)) { return undefined; }
      return readOptionalBytes(fs, paths.join(templatesDir, entry.id, "preview", "thumbnail.png"));
    },
    async files(entry: TemplateEntry): Promise<TemplateFile[]> {
      if (!plainId(entry.id)) { throw new Error(`"${entry.id}" is not a template id`); }
      try {
        return await readLibraryTemplateTree(fs, paths, paths.join(templatesDir, entry.id, "files"));
      } catch (error) {
        await logger.error(MODULE, error, { action: "read My template", id: entry.id });
        throw error;
      }
    },
  };
}
