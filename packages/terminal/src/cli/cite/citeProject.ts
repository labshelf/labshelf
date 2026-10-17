// Finds the writing project a citation is for and adds the cited paper to the project's bibliography file.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_BIBLIOGRAPHY, PROJECT_FILE, generateBibliography,
  type ILogger, type PaperRecord, type ProjectEntry,
} from "@labshelf/core";
import {
  projectCitationKeys, readOptionalFile, readProject, updateProjectBibliography, writeFileAtomic,
} from "@labshelf/core/node";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

async function hasProjectFile(folder: string): Promise<boolean> {
  return fs.stat(path.join(folder, PROJECT_FILE)).then((stat) => stat.isFile(), () => false);
}

/** The folder itself, else the nearest folder above it that holds labshelf.yaml. */
async function enclosingProject(start: string, climb: boolean): Promise<string | undefined> {
  for (let folder = start; ; folder = path.dirname(folder)) {
    if (await hasProjectFile(folder)) { return folder; }
    if (!climb || path.dirname(folder) === folder) { return undefined; }
  }
}

/**
 * @param folder the project folder named on the command line, or undefined to search up from the working directory
 * @returns the project, or a reason it cannot take a bibliography
 */
export async function locateProject(
  folder: string | undefined, logger: ILogger,
): Promise<{ project: ReadyProject } | { reason: string }> {
  const start = path.resolve(folder ?? process.cwd());
  const found = await enclosingProject(start, folder === undefined);
  if (found === undefined) { return { reason: `no ${PROJECT_FILE} in ${start}` }; }
  const entry = await readProject(found, "external", logger);
  return entry.kind === "ready" ? { project: entry } : { reason: entry.reason };
}

/**
 * Regenerates labshelf.bib from the keys the project's sources cite plus the picked paper, which the user is about to
 * paste into a source. updateProjectBibliography runs first so the main file loads the bibliography and labshelf.yaml
 * lists the cited papers; its file lacks the picked key, so the file is completed afterwards.
 */
export async function addToBibliography(
  project: ReadyProject, picked: PaperRecord, papers: readonly PaperRecord[], logger: ILogger,
): Promise<void> {
  await updateProjectBibliography(project, papers, logger);
  const keys = [...await projectCitationKeys(project.folder, project.settings.format), picked.citeKey];
  const generated = generateBibliography(keys, papers);
  const file = path.join(project.folder, project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY);
  if (await readOptionalFile(file) === generated.text) { return; }
  await writeFileAtomic(file, generated.text);
  await logger.log("INFO", "terminal.cite", "Paper added to the project bibliography", {
    file, key: picked.citeKey, entries: generated.resolved.length,
  });
}
