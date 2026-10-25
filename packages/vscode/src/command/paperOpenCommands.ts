// Registers the commands that open a paper: in the LabShelf reader, externally, its folder, or copying its citation key.
import * as vscode from "vscode";

import { type PaperRecord, paperFiles } from "@labshelf/core";
import { ensurePaperPdf, resolvePaper } from "./paperResolution.js";
import { executeSafely, type RequireServices } from "./commandContext.js";

function registerReaderOpenCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaper", async () => {
        const paper = await resolvePaper(services.paperService, undefined, "Open paper");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.searchLibrary", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.searchLibrary", async () => {
        const paper = await resolvePaper(services.paperService, undefined, "Search library");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaperPdfExternal", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaperPdfExternal", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Open paper PDF in default viewer");
        if (paper && await ensurePaperPdf(services, paper)) {
          await openPaperPdfExternal(paper);
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.openPaperPdf", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaperPdf", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Open paper PDF");
        if (paper) {
          await openPaperPdf(paper);
        }
      });
    }),
  );
}

function registerFolderAndCitationCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPaperFolder", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.openPaperFolder", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Reveal paper folder");
        if (paper) {
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(paper.path));
        }
      });
    }),
    vscode.commands.registerCommand("labshelf.copyCitation", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.copyCitation", async () => {
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

export function registerPaperOpenCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  registerReaderOpenCommands(context, requireServices);
  registerFolderAndCitationCommands(context, requireServices);
}

// Opens the paper in the LabShelf reader.
async function openPaperPdf(paper: PaperRecord): Promise<void> {
  await vscode.commands.executeCommand("labshelf.openPdfViewer", paper.id);
}

// Escape hatch: hands paper.pdf to VS Code's default handler (or the OS viewer) instead of the LabShelf reader.
async function openPaperPdfExternal(paper: PaperRecord): Promise<void> {
  const pdf = paperFiles(vscode.Uri.file(paper.path), vscode.Uri.joinPath).pdf;
  await vscode.commands.executeCommand("vscode.open", pdf);
}
