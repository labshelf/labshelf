// Orchestrates registration of every labshelf.* command by calling each thematic group in turn.
import * as vscode from "vscode";

import { registerImportCommands } from "./importCommands.js";
import { registerTextLayerCommands } from "./textLayerCommands.js";
import { type EnsureServices, runSafely } from "./commandContext.js";
import { type PaperRecord, type PaperService, createPaperFiles } from "@labshelf/core";
import { ensurePaperPdf, resolvePaper } from "./paperResolution.js";
import { fetchMetadataForPaper, resolveMissingMetadata } from "./fetchMetadata.js";

const REMOVE = "Remove";

/** A paper whose folder cannot be trashed stays in the list, and the user is told why. */
async function removePapers(paperService: PaperService, papers: PaperRecord[]): Promise<void> {
  if (papers.length === 0) { return; }
  const what = papers.length === 1 ? `"${papers[0]!.title}"` : `${papers.length} papers`;
  const choice = await vscode.window.showWarningMessage(
    `Remove ${what} from the library?`,
    { modal: true, detail: "The folder and its files move to the trash, on this device and on every synced device." },
    REMOVE,
  );
  if (choice !== REMOVE) { return; }
  const outcome = await paperService.trashPapers(papers.map((paper) => paper.id));
  const firstFailure = outcome.failed[0];
  if (firstFailure) {
    const title = papers.find((paper) => paper.id === firstFailure.id)?.title ?? firstFailure.id;
    const others = outcome.failed.length > 1 ? ` (and ${outcome.failed.length - 1} more)` : "";
    void vscode.window.showErrorMessage(`LabShelf: Could not move "${title}"${others} to the trash — ${firstFailure.error}`);
  }
  if (outcome.done.length > 0) {
    vscode.window.setStatusBarMessage(`LabShelf: removed ${outcome.done.length === 1 && !firstFailure ? what : `${outcome.done.length} papers`}`, 3000);
  }
}

function registerMetadataCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.fetchMetadata", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.fetchMetadata", async () => {
        const paper = paperId
          ? (await services.paperService.listPapers()).find((entry) => entry.id === paperId)
          : await resolvePaper(services.paperService, undefined, "Select the paper to look up");
        if (!paper) { return; }
        await fetchMetadataForPaper(services.paperService, paper, services.logger);
      });
    }),
    vscode.commands.registerCommand("labshelf.resolveMissingMetadata", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.resolveMissingMetadata", async () => {
        await resolveMissingMetadata(services.paperService, services.logger);
      });
    }),
    vscode.commands.registerCommand("labshelf.deletePaper", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.deletePaper", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Remove paper from library");
        if (!paper) {
          return;
        }
        await removePapers(services.paperService, [paper]);
      });
    }),
  );
}

function registerReaderOpenCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.openPaper", async () => {
        const paper = await resolvePaper(services.paperService, undefined, "Open paper");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.searchLibrary", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.searchLibrary", async () => {
        const paper = await resolvePaper(services.paperService, undefined, "Search library");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaperPdfExternal", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.openPaperPdfExternal", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Open paper PDF in default viewer");
        if (paper && await ensurePaperPdf(services, paper)) {
          await openPaperPdfExternal(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaperPdf", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.openPaperPdf", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Open paper PDF");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
  );
}

function registerFolderAndCitationCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPaperFolder", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.openPaperFolder", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Reveal paper folder");
        if (paper) {
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(paper.path));
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.copyCitation", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.copyCitation", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Copy citation key");
        if (!paper) {
          return;
        }
        await vscode.env.clipboard.writeText(paper.citeKey);
        vscode.window.setStatusBarMessage(`LabShelf: copied @${paper.citeKey}`, 2000);
      });
    }),
  );
}

function registerPaperOpenCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  registerReaderOpenCommands(context, requireServices);
  registerFolderAndCitationCommands(context, requireServices);
}

// Opens the paper in the LabShelf reader.
async function openPaperPdf(paper: PaperRecord): Promise<void> {
  await vscode.commands.executeCommand("labshelf.openPdfViewer", paper.id);
}

// Escape hatch: hands paper.pdf to VS Code's default handler (or the OS viewer) instead of the LabShelf reader.
async function openPaperPdfExternal(paper: PaperRecord): Promise<void> {
  const pdf = createPaperFiles(vscode.Uri.file(paper.path), vscode.Uri.joinPath).pdf;
  await vscode.commands.executeCommand("vscode.open", pdf);
}

function registerMaintenanceCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.generateBibTeX", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.generateBibTeX", async () => {
        const regeneratedCount = await services.paperService.regenerateBibTeX();
        await vscode.window.showInformationMessage(`Regenerated BibTeX for ${regeneratedCount} paper(s).`);
      });
    }),
    vscode.commands.registerCommand("labshelf.rebuildIndex", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.rebuildIndex", async () => {
        const summary = await services.reindexLibrary();
        const changed = summary.added.length + summary.updated.length + summary.removed.length;
        void vscode.window.showInformationMessage(
          changed > 0
            ? `LabShelf: index rebuilt — ${summary.added.length} added, ${summary.updated.length} updated, ${summary.removed.length} removed.`
            : "LabShelf: index rebuilt; nothing changed.",
        );
      });
    }),
    vscode.commands.registerCommand("labshelf.openSidebar", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.labshelfContainer");
    }),
  );
}

/** Registers all labshelf.* commands onto the extension context subscriptions */
export function registerCommands(
  context: vscode.ExtensionContext,
  requireServices: EnsureServices,
): void {
  registerImportCommands(context, requireServices);
  registerTextLayerCommands(context, requireServices);
  registerPaperOpenCommands(context, requireServices);
  registerMaintenanceCommands(context, requireServices);
  registerMetadataCommands(context, requireServices);
}
