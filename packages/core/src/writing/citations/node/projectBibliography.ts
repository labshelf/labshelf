/** Regenerates a project's labshelf.bib from the keys its sources cite and loads it from the main file on the first citation. */
// CONTRACT: documents/contracts/library-format.md#labshelfbib

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "../../../library/node/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger } from "../../../ports/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectFormat, type ProjectSettings } from "../../project/index.js";
import { updateProjectSettings } from "../../project/node/index.js";
import { generateBibliography } from "../bibliographyFile.js";
import { withBibliographyLine } from "../bibliographyLine.js";
import { scanCitationKeys } from "../citationKeys.js";

export interface CitingProject {
  folder: string;
  settings: ProjectSettings;
  /** Main file relative to the folder; undefined when the project has none yet. */
  main: string | undefined;
}

export interface BibliographyUpdate {
  /** True when labshelf.bib was written; an unchanged file is not rewritten. */
  written: boolean;
  missing: string[];
  /** "conflict": the Typst main file already loads another bibliography, so labshelf.bib must be added by hand. */
  mainLine: "present" | "added" | "conflict" | "no-main" | "not-needed";
}

/** The host's open editors: their unsaved text wins over the disk, and edits to an open file go through the editor. */
export interface OpenSources {
  /** The text of an open document, or undefined when the file is not open. */
  text(file: string): string | undefined;
  /** Replaces the whole text of an open document; false when the file is not open. */
  replace(file: string, text: string): Promise<boolean>;
}

const DISK_ONLY: OpenSources = { text: () => undefined, replace: async () => false };

const SOURCE_EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };

async function readOptional(file: string): Promise<string | undefined> {
  return fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return undefined; }
    throw error;
  });
}

/** Keys cited anywhere in the project's sources; hidden folders and node_modules are not sources. */
export async function projectCitationKeys(
  folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): Promise<string[]> {
  const keys = new Set<string>();
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") { await visit(full); }
      if (entry.isFile() && entry.name.endsWith(SOURCE_EXTENSION[format])) {
        for (const key of scanCitationKeys(format, open.text(full) ?? await fs.readFile(full, "utf8"))) { keys.add(key); }
      }
    }
  };
  await visit(folder);
  return [...keys];
}

async function addMainLine(
  project: CitingProject, bibFile: string, open: OpenSources, logger: ILogger,
): Promise<BibliographyUpdate["mainLine"]> {
  if (project.main === undefined) { return "no-main"; }
  const mainPath = path.join(project.folder, project.main);
  const text = open.text(mainPath) ?? await readOptional(mainPath);
  if (text === undefined) { return "no-main"; }
  const relative = path.relative(path.dirname(mainPath), path.join(project.folder, bibFile)).split(path.sep).join("/");
  const result = withBibliographyLine(project.settings.format, text, relative);
  // An open main file is edited in the editor, so the user's unsaved changes and undo history survive.
  if (result.kind === "added" && !await open.replace(mainPath, result.text)) { await writeFileAtomic(mainPath, result.text); }
  if (result.kind === "conflict") {
    await logger.log("WARN", "citations", "main file loads another bibliography", { main: mainPath, bibFile });
  }
  return result.kind;
}

/**
 * Writes labshelf.bib for the project's current citations. The main file and labshelf.yaml are touched only until
 * the main file loads labshelf.bib, starting with the first cited library paper and after labshelf.bib exists.
 */
export async function updateProjectBibliography(
  project: CitingProject, papers: readonly PaperRecord[], logger: ILogger, open: OpenSources = DISK_ONLY,
): Promise<BibliographyUpdate> {
  const bibFile = project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const bibPath = path.join(project.folder, bibFile);
  const generated = generateBibliography(await projectCitationKeys(project.folder, project.settings.format, open), papers);
  const current = await readOptional(bibPath);
  const needed = generated.resolved.length > 0 || current !== undefined;
  const written = needed && current !== generated.text;
  if (written) { await writeFileAtomic(bibPath, generated.text); }
  let mainLine: BibliographyUpdate["mainLine"] = "not-needed";
  // PLATFORM: Typst fails the build when #bibliography names a missing file, so the line follows the file.
  if (generated.resolved.length > 0 && project.settings.bibliography === undefined) {
    mainLine = await addMainLine(project, bibFile, open, logger);
    // Recorded only once the main file loads it, so a conflict or a missing main is retried on the next update.
    if (mainLine === "added" || mainLine === "present") {
      await updateProjectSettings(project.folder, { bibliography: bibFile }, logger);
    }
  }
  // Runs on every save, so only a change is worth a log line.
  if (written || mainLine === "added") {
    await logger.log("INFO", "citations", "project bibliography updated", {
      folder: project.folder, entries: generated.resolved.length, missing: generated.missing.length, mainLine,
    });
  }
  return { written, missing: generated.missing, mainLine };
}
