/** Lists the user's own templates from <library>/templates and reads their files. */
// CONTRACT: documents/contracts/templates.md#my-templates
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { PathOps } from "../../library/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { parseTemplateManifest, templatePathProblem } from "../templateManifest/index.js";
import type { TemplateFile, TemplateListing, TemplateSource } from "../sources/index.js";
import { readLibraryTemplateTree } from "./readLibraryTemplateTree.js";
import { readOptionalBytes } from "./readOptionalBytes.js";
import { walkLibraryFolder } from "./walkLibraryFolder.js";

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
  const plainId = (id: string): boolean => !id.includes("/") && templatePathProblem(id) === undefined;

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
