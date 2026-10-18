// Regenerates a project's labshelf.bib from the keys its sources cite and loads it from the main file on the first citation.
// CONTRACT: documents/contracts/library-format.md#labshelfbib
import { mergeGeneratedBibliography } from "../../../collab/model/index.js";
import type { PaperRecord } from "../../../model/index.js";
import { readOptionalText, type ProjectReadContext } from "../../project/folder/index.js";
import { DEFAULT_BIBLIOGRAPHY, updateProjectSettings, type OpenSources, type ProjectFormat } from "../../project/index.js";
import { generateBibliography } from "../bibliographyFile.js";
import { withBibliographyLine } from "../bibliographyLine.js";
import { scanCitationKeys } from "../citationKeys.js";
import type { BibliographyUpdate, CitingProject } from "../listedPapersSync.js";
import { DISK_ONLY, projectSources } from "../sources/index.js";
import { syncProjectPapers } from "./projectPapersSync.js";

/** Keys cited anywhere in the project's sources; hidden folders and node_modules are not sources. */
export async function projectCitationKeys(
  context: Pick<ProjectReadContext, "fs" | "paths">, folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): Promise<string[]> {
  const keys = new Set<string>();
  for await (const source of projectSources(context, folder, format, open)) {
    for (const key of scanCitationKeys(format, source.text)) { keys.add(key); }
  }
  return [...keys];
}

async function addMainLine(
  { fs, paths, logger }: ProjectReadContext, project: CitingProject, bibFile: string, open: OpenSources,
): Promise<BibliographyUpdate["mainLine"]> {
  if (project.main === undefined) { return "no-main"; }
  const mainPath = paths.join(project.folder, project.main);
  const text = open.text(mainPath) ?? await readOptionalText(fs, mainPath);
  if (text === undefined) { return "no-main"; }
  const relative = paths.relative(paths.dirname(mainPath), paths.join(project.folder, bibFile)).split(paths.sep).join("/");
  const result = withBibliographyLine(project.settings.format, text, relative);
  // An open main file is edited in the editor, so the user's unsaved changes and undo history survive.
  if (result.kind === "added" && !await open.replace(mainPath, result.text)) { await fs.writeText(mainPath, result.text); }
  if (result.kind === "conflict") {
    await logger.log("WARN", "citations", "main file loads another bibliography", { main: mainPath, bibFile });
  }
  return result.kind;
}

// CONTRACT: documents/contracts/collaboration.md#bibliography
/** A shared labshelf.bib also holds other members' entries, so the generated one is merged in and never replaces it. */
async function mergedIntoShared(
  { logger }: ProjectReadContext, bibPath: string, current: string | undefined, generated: string,
): Promise<string> {
  const merged = mergeGeneratedBibliography(current ?? "", generated);
  for (const clash of merged.clashes) {
    await logger.log("WARN", "citations", "shared bibliography keeps another member's entry under a clashing cite key", { bibPath, ...clash });
  }
  return merged.text;
}

/**
 * Writes labshelf.bib for the project's current citations and keeps the `papers` list of labshelf.yaml in sync with
 * them. The main file and `bibliography:` are touched only until the main file loads labshelf.bib, starting with the
 * first cited library paper and after labshelf.bib exists.
 */
export async function updateProjectBibliography(
  context: ProjectReadContext, project: CitingProject, papers: readonly PaperRecord[], open: OpenSources = DISK_ONLY,
): Promise<BibliographyUpdate> {
  const { fs, paths, logger } = context;
  const bibFile = project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const bibPath = paths.join(project.folder, bibFile);
  const keys = await projectCitationKeys(context, project.folder, project.settings.format, open);
  const generated = generateBibliography(keys, papers);
  const current = await readOptionalText(fs, bibPath);
  const needed = generated.resolved.length > 0 || current !== undefined;
  const text = project.settings.shared === undefined ? generated.text : await mergedIntoShared(context, bibPath, current, generated.text);
  const written = needed && current !== text;
  if (written) { await fs.writeText(bibPath, text); }
  let mainLine: BibliographyUpdate["mainLine"] = "not-needed";
  // PLATFORM: Typst fails the build when #bibliography names a missing file, so the line follows the file.
  if (generated.resolved.length > 0 && project.settings.bibliography === undefined) {
    mainLine = await addMainLine(context, project, bibFile, open);
    // Recorded only once the main file loads it, so a conflict or a missing main is retried on the next update.
    if (mainLine === "added" || mainLine === "present") {
      await updateProjectSettings(context, project.folder, { bibliography: bibFile });
    }
  }
  const papersWritten = await syncProjectPapers(context, project.folder, keys, papers);
  // Runs on every save, so only a change is worth a log line.
  if (written || mainLine === "added" || papersWritten) {
    await logger.log("INFO", "citations", "project bibliography updated", {
      folder: project.folder, entries: generated.resolved.length, missing: generated.missing.length, mainLine, papersWritten,
    });
  }
  return { written, papersWritten, missing: generated.missing, mainLine };
}
