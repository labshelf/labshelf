/** Reads a project's LaTeX or Typst sources, taking an open editor's unsaved text over the disk. */
import { promises as fs } from "node:fs";

import type { OpenSources, ProjectFormat } from "../../project/index.js";
import { listProjectFiles } from "../../project/node/index.js";

export const DISK_ONLY: OpenSources = { text: () => undefined, replace: async () => false };

const SOURCE_EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };

export interface ProjectSource {
  /** Absolute path. */
  file: string;
  text: string;
}

/** Every source file of the format under the folder, with its text; hidden folders and node_modules are not sources. */
export async function* projectSources(
  folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): AsyncGenerator<ProjectSource> {
  for (const file of await listProjectFiles(folder)) {
    if (!file.endsWith(SOURCE_EXTENSION[format])) { continue; }
    yield { file, text: open.text(file) ?? await fs.readFile(file, "utf8") };
  }
}
