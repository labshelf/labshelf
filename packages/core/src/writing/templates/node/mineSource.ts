/** Lists the user's own templates from <library>/templates and reads their files. */
// CONTRACT: documents/contracts/templates.md#my-templates

import * as fs from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { parseTemplateManifest, templatePathProblem } from "../manifest/index.js";
import type { TemplateFile, TemplateListing, TemplateSource } from "../sources/index.js";
import { readOptionalFile } from "./readOptionalFile.js";
import { readTemplateTree } from "./readTemplateTree.js";
import { walkFolder } from "./walkFolder.js";

const MODULE = "templates";

export interface MineSourceDeps {
  libraryRoot: string;
  logger: ILogger;
}

async function listFilePaths(folder: string, logger: ILogger): Promise<string[] | undefined> {
  try {
    return (await walkFolder(folder)).map((file) => file.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await logger.error(MODULE, error, { action: "list My template files", folder });
    }
    return undefined;
  }
}

async function readEntry(templatesDir: string, folderName: string, logger: ILogger): Promise<TemplateEntry | undefined> {
  const text = await readOptionalFile(path.join(templatesDir, folderName, "template.yaml"));
  if (text === undefined) { return undefined; }
  const parsed = parseTemplateManifest(text.toString("utf8"));
  const reason = !parsed.ok ? parsed.reason : parsed.manifest.id !== folderName ? `id "${parsed.manifest.id}" differs from the folder name` : undefined;
  if (!parsed.ok || reason !== undefined) {
    await logger.error(MODULE, new Error(`My template left out: ${reason}`), { folder: folderName });
    return undefined;
  }
  const files = await listFilePaths(path.join(templatesDir, folderName, "files"), logger);
  return { ...parsed.manifest, source: "mine", ...(files === undefined ? {} : { files }) };
}

export function createMineSource({ libraryRoot, logger }: MineSourceDeps): TemplateSource {
  const templatesDir = path.join(libraryRoot, "templates");

  return {
    id: "mine",
    async list(): Promise<TemplateListing> {
      let names: string[];
      try {
        names = await fs.promises.readdir(templatesDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { return { entries: [], fromCache: false }; }
        throw error;
      }
      const entries: TemplateEntry[] = [];
      for (const name of names.sort()) {
        const entry = await readEntry(templatesDir, name, logger);
        if (entry !== undefined) { entries.push(entry); }
      }
      return { entries, fromCache: false };
    },
    async thumbnail(entry: TemplateEntry): Promise<Uint8Array | undefined> {
      if (entry.id.includes("/") || templatePathProblem(entry.id) !== undefined) { return undefined; }
      const bytes = await readOptionalFile(path.join(templatesDir, entry.id, "preview", "thumbnail.png"));
      return bytes === undefined ? undefined : new Uint8Array(bytes);
    },
    async files(entry: TemplateEntry): Promise<TemplateFile[]> {
      // The id becomes a folder name, so anything but a plain segment could leave <library>/templates.
      if (entry.id.includes("/") || templatePathProblem(entry.id) !== undefined) {
        throw new Error(`"${entry.id}" is not a template id`);
      }
      try {
        return await readTemplateTree(path.join(templatesDir, entry.id, "files"));
      } catch (error) {
        await logger.error(MODULE, error, { action: "read My template", id: entry.id });
        throw error;
      }
    },
  };
}
