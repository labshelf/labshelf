/** Regenerates a project's labshelf.bib from the keys its sources cite and loads it from the main file on the first citation. */
// CONTRACT: documents/contracts/library-format.md#labshelfbib

import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger } from "../../../ports/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectFormat, type ProjectSettings } from "../../project/index.js";
import { updateProjectSettings } from "../../project/node/index.js";
import { generateBibliography } from "../bibliographyFile.js";
import { withBibliographyLine } from "../bibliographyLine.js";
import { scanCitationKeys } from "../citationKeys.js";
import { syncProjectPapers } from "./projectPapersSync.js";
import { DISK_ONLY, projectSources, type OpenSources } from "./projectSources.js";

export interface CitingProject {
  folder: string;
  settings: ProjectSettings;
  /** Main file relative to the folder; undefined when the project has none yet. */
  main: string | undefined;
}

export interface BibliographyUpdate {
  /** True when labshelf.bib was written; an unchanged file is not rewritten. */
  written: boolean;
  /** True when the papers list of labshelf.yaml was rewritten. */
  papersWritten: boolean;
  missing: string[];
  /** "conflict": the Typst main file already loads another bibliography, so labshelf.bib must be added by hand. */
  mainLine: "present" | "added" | "conflict" | "no-main" | "not-needed";
}

/** Keys cited anywhere in the project's sources; hidden folders and node_modules are not sources. */
export async function projectCitationKeys(
  folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): Promise<string[]> {
  const keys = new Set<string>();
  for await (const source of projectSources(folder, format, open)) {
    for (const key of scanCitationKeys(format, source.text)) { keys.add(key); }
  }
  return [...keys];
}

async function addMainLine(
  project: CitingProject, bibFile: string, open: OpenSources, logger: ILogger,
): Promise<BibliographyUpdate["mainLine"]> {
  if (project.main === undefined) { return "no-main"; }
  const mainPath = path.join(project.folder, project.main);
  const text = open.text(mainPath) ?? await readOptionalFile(mainPath);
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
 * Writes labshelf.bib for the project's current citations and keeps the `papers` list of labshelf.yaml in sync with
 * them. The main file and `bibliography:` are touched only until the main file loads labshelf.bib, starting with the
 * first cited library paper and after labshelf.bib exists.
 */
export async function updateProjectBibliography(
  project: CitingProject, papers: readonly PaperRecord[], logger: ILogger, open: OpenSources = DISK_ONLY,
): Promise<BibliographyUpdate> {
  const bibFile = project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const bibPath = path.join(project.folder, bibFile);
  const keys = await projectCitationKeys(project.folder, project.settings.format, open);
  const generated = generateBibliography(keys, papers);
  const current = await readOptionalFile(bibPath);
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
  const papersWritten = await syncProjectPapers(project.folder, keys, papers, logger);
  // Runs on every save, so only a change is worth a log line.
  if (written || mainLine === "added" || papersWritten) {
    await logger.log("INFO", "citations", "project bibliography updated", {
      folder: project.folder, entries: generated.resolved.length, missing: generated.missing.length, mainLine, papersWritten,
    });
  }
  return { written, papersWritten, missing: generated.missing, mainLine };
}
