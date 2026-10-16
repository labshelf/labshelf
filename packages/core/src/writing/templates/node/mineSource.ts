/** Lists the user's own templates from <library>/templates and reads their files. */
// CONTRACT: documents/contracts/templates.md#my-templates

import * as fs from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { parseTemplateManifest } from "../templateManifest.js";
import { templatePathProblem } from "../templatePaths.js";
import type { TemplateFile, TemplateSource } from "../sources/index.js";
import { readTemplateTree } from "./readTemplateTree.js";

const MODULE = "templates";

export interface MineSourceDeps {
  libraryRoot: string;
  logger: ILogger;
}

async function readManifestText(file: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

export function createMineSource({ libraryRoot, logger }: MineSourceDeps): TemplateSource {
  const templatesDir = path.join(libraryRoot, "templates");

  async function readEntry(folderName: string): Promise<TemplateEntry | undefined> {
    const text = await readManifestText(path.join(templatesDir, folderName, "template.yaml"));
    if (text === undefined) { return undefined; }
    const parsed = parseTemplateManifest(text);
    const reason = !parsed.ok ? parsed.reason : parsed.manifest.id !== folderName ? `id "${parsed.manifest.id}" differs from the folder name` : undefined;
    if (!parsed.ok || reason !== undefined) {
      await logger.error(MODULE, new Error(`My template left out: ${reason}`), { folder: folderName });
      return undefined;
    }
    return { ...parsed.manifest, source: "mine" };
  }

  return {
    id: "mine",
    async list(): Promise<TemplateEntry[]> {
      let names: string[];
      try {
        names = await fs.promises.readdir(templatesDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
        throw error;
      }
      const entries: TemplateEntry[] = [];
      for (const name of names.sort()) {
        const entry = await readEntry(name);
        if (entry !== undefined) { entries.push(entry); }
      }
      return entries;
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
