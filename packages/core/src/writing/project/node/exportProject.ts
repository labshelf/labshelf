// Runs the Node side of leaving a project: converts its main file with the pandoc on PATH, and clears the flat build files a root left in the project build folder.
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { findExecutable } from "../../../latex/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { createPandocArgs, type DocumentExport } from "../projectExport.js";
import type { ProjectFormat } from "../projectFile.js";

const run = promisify(execFile);

export const PANDOC_MISSING_MESSAGE = "Exporting to Word, Markdown or HTML needs pandoc. Install it from https://pandoc.org, then try again.";

export interface PandocRequest {
  format: ProjectFormat;
  /** The project folder; pandoc runs in it. */
  folder: string;
  /** The main file, relative to `folder`. */
  main: string;
  target: DocumentExport;
  output: string;
}

/** @throws with PANDOC_MISSING_MESSAGE when pandoc is not on PATH, or with pandoc's error output when it fails */
export async function exportWithPandoc(request: PandocRequest): Promise<void> {
  const pandoc = await findExecutable("pandoc");
  if (!pandoc) { throw new Error(PANDOC_MISSING_MESSAGE); }
  try {
    await run(pandoc, createPandocArgs(request.format, request.main, request.target, request.output), { cwd: request.folder });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`pandoc failed on ${request.main}${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
}

// --- Flat build files ---

const MODULE = "writing.project.clearFlatBuildFiles";

// Flat layouts wrote `<base>.aux`, `<base>.pdf` and friends straight into the project build dir; stale copies would shadow the per-root folder's output.
export async function removeFlatBuildFiles(projectBuildDir: string, root: string, logger: ILogger): Promise<void> {
  const base = path.posix.basename(root, path.posix.extname(root));
  let entries;
  try {
    entries = await fs.readdir(projectBuildDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    await logger.error(MODULE, error, { projectBuildDir, root, step: "list" });
    return;
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${base}.`)) continue;
    try {
      await fs.rm(path.join(projectBuildDir, entry.name), { force: true });
      removed.push(entry.name);
    } catch (error) {
      await logger.error(MODULE, error, { projectBuildDir, root, file: entry.name, step: "remove" });
    }
  }
  if (removed.length > 0) await logger.log("INFO", MODULE, "Removed flat build files", { projectBuildDir, root, removed });
}
