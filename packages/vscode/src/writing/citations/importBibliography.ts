// The Import a .bib file command: writes a library paper for each entry the library lacks, into a new library folder, links the folder to the project and syncs its bibliography.
import * as vscode from "vscode";

import {
  createPaperFromBibEntry, deriveImportFolderName, describeBibImport, parseBibEntries, planBibImport, PAPERS_DIR,
  type MutationContext, type PaperRecord,
} from "@labshelf/core";
import type { ReadyProject } from "../projects/index.js";
import { runOnProject, writeFolders, type LibraryFolderDeps } from "./libraryFolders.js";

const IMPORT_BIBLIOGRAPHY_COMMAND = "labshelf.writing.importBibliography";

/** What writing papers needs from the open library. */
interface BibliographyImportLibrary {
  ctx: MutationContext;
  /** The ids of the library's papers, so a new paper's folder never collides with one. */
  takenIds: () => string[];
  /** Puts the written papers in the index. */
  reindex: () => Promise<unknown>;
}

export interface ImportBibliographyDeps extends LibraryFolderDeps {
  library: () => BibliographyImportLibrary | undefined;
}

/** Names at the library root: folders and papers, by their first path segment, lower-cased. */
function rootNames(papers: readonly PaperRecord[]): Set<string> {
  return new Set(papers.flatMap((paper) => { const parts = paper.path.split("/"); return parts[0] === PAPERS_DIR && parts[1] ? [parts[1].toLowerCase()] : []; }));
}

async function writePapers(
  library: BibliographyImportLibrary, folderDir: string, entries: ReturnType<typeof parseBibEntries>, sourceName: string, progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<{ written: number; failed: number }> {
  const taken = library.takenIds();
  let written = 0;
  let failed = 0;
  for (const entry of entries) {
    progress.report({ message: `${written + failed + 1} of ${entries.length}`, increment: 100 / entries.length });
    try {
      taken.push((await createPaperFromBibEntry(library.ctx, taken, folderDir, entry, sourceName)).id);
      written++;
    } catch (error) {
      failed++;
      await library.ctx.logger.error("citations", error, { key: entry.key, action: "import-bibliography" });
    }
  }
  return { written, failed };
}

async function importBibliography(deps: ImportBibliographyDeps, target: ReadyProject | undefined): Promise<void> {
  await runOnProject(deps, target, IMPORT_BIBLIOGRAPHY_COMMAND, async (project) => {
    const library = deps.library();
    if (!library) { void vscode.window.showInformationMessage("Open a library first."); return; }
    const [file] = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { BibTeX: ["bib"] }, openLabel: "Import", title: "Import a .bib file" }) ?? [];
    if (!file) { return; }
    const { ctx } = library;
    const entries = parseBibEntries(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
    const papers = await deps.listPapers();
    const plan = planBibImport(entries, papers);
    if (plan.fresh.length === 0) {
      void vscode.window.showInformationMessage(entries.length === 0 ? `${ctx.paths.basename(file.fsPath)} has no entries.` : `All ${entries.length} entries are already in your library.`);
      return;
    }
    const names = rootNames(papers);
    const folder = await deriveImportFolderName(ctx.paths.basename(file.fsPath), async (name) => names.has(name.toLowerCase()) || await ctx.fs.exists(ctx.paths.join(ctx.papersRoot, name)));
    const { written, failed } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Importing ${ctx.paths.basename(file.fsPath)}` },
      (progress) => writePapers(library, ctx.paths.join(ctx.papersRoot, folder), plan.fresh, ctx.paths.basename(file.fsPath), progress),
    );
    await library.reindex();
    if (written > 0) { await writeFolders(deps, project, [...project.settings.libraryFolders ?? [], folder]); }
    const summary = describeBibImport(written, folder, plan.existing.length);
    void (failed > 0
      ? vscode.window.showWarningMessage(`${summary} ${failed} could not be written; the LabShelf log says why.`)
      : vscode.window.showInformationMessage(summary));
  });
}

export function registerImportBibliographyCommand(deps: ImportBibliographyDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(IMPORT_BIBLIOGRAPHY_COMMAND, (target?: ReadyProject) => importBibliography(deps, target)),
  );
}
