// Registers the Writing sidebar view, its commands, the main-document and compiler status bar items, the LaTeX and Typst builds with the LaTeX Workshop notice, the Tinymist bridge and the preview, the citation providers, the labshelf: links, the figures with Regenerate Figure, the LaTeX command completion, the source-aware LaTeX editing and the value completion and hover, and reloads the project list when the library root changes.
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import {
  WritingProjects, WritingTreeProvider, registerMainCommands, registerMainStatusBar, registerProjectCommands,
  registerProjectItemCommands, type WritingHost,
} from "../../writing/index.js";
import {
  BuildDiagnostics, registerBuildCommand, registerCompilerStatusBar, registerLatexBuild, registerLatexWorkshopNotice, registerPickCompiler,
} from "../../writing/build/index.js";
import { registerTinymistBridge, registerTypstBuild } from "../../writing/typst/index.js";
import { BuildPreviews, registerShowInPreview, registerShowPreview } from "../../writing/preview/index.js";
import { registerCitationProviders, type CitationWorkspace } from "../../writing/citations/index.js";
import { registerLabshelfLinks } from "../../writing/links/index.js";
import { ProjectFigures, registerRegenerateFigure, watchFigureFiles } from "../../writing/figures/index.js";
import { registerLatexCommandCompletion, registerLatexEditing } from "../../writing/latexEditing/index.js";
import { registerWritingValues } from "../../writing/values/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";
import { registerCheckCommand } from "../../writing/check/index.js";
import { hostPdfjs } from "../../pdf/node/index.js";

export function registerWritingView(context: vscode.ExtensionContext, controller: LibraryRootController, reader: HostAdapters["reader"]): void {
  const current = (): ReturnType<WritingHost["current"]> => {
    const root = controller.currentRoot();
    const services = controller.currentServices();
    return root && services ? { root: root.fsPath, logger: services.logger } : undefined;
  };
  const host: WritingHost = {
    current,
    // Offers the library setup when none is configured.
    require: async () => { await controller.require(); return current(); },
  };

  const projects = new WritingProjects(host);
  const figures = new ProjectFigures(host);
  const provider = new WritingTreeProvider(projects, figures);
  context.subscriptions.push(
    projects,
    figures,
    provider,
    watchFigureFiles(projects, () => figures.refresh()),
    vscode.window.createTreeView("labshelf.writing", { treeDataProvider: provider }),
    controller.onDidChangeRoot(() => void projects.reload()),
  );
  registerProjectCommands({ context, host, projects });
  registerProjectItemCommands({ context, host, projects });
  registerMainCommands({ context, host, projects });
  registerMainStatusBar(context, projects);
  const figureOutput = vscode.window.createOutputChannel("LabShelf Figures");
  context.subscriptions.push(figureOutput);
  registerRegenerateFigure({ context, host, figures, output: figureOutput });
  const listPapers = async (): Promise<PaperRecord[]> => await controller.currentServices()?.paperService.listPapers() ?? [];
  const previews = new BuildPreviews({ host, listPapers, extensionUri: context.extensionUri, ...reader });
  const diagnostics = new BuildDiagnostics();
  context.subscriptions.push(diagnostics);
  const builders = {
    latex: registerLatexBuild({ context, host, projects, previews, diagnostics }),
    typst: registerTypstBuild({ context, host, projects, previews, diagnostics, hasPreview: (folder) => previews.hasPreview(folder) }),
  };
  registerBuildCommand({ context, projects, builders });
  registerCheckCommand({ context, host, projects, builders, pdfjs: hostPdfjs });
  registerTinymistBridge(context, { host, projects });
  registerShowPreview({ context, projects, previews });
  registerShowInPreview({ context, projects, previews });
  registerPickCompiler({ context, host, projects });
  registerCompilerStatusBar(context, projects);
  registerLatexWorkshopNotice({ context, host, projects });
  const session = (): ReturnType<CitationWorkspace["session"]> => {
    const services = controller.currentServices();
    return services ? {
      listPapers: () => services.paperService.listPapers(),
      highlightsOf: (paperId) => services.paperDataStore.getAnnotations(paperId),
      logger: services.logger,
    } : undefined;
  };
  registerCitationProviders(context, { projects, session });
  registerLabshelfLinks(context, { session });
  registerLatexCommandCompletion(context);
  registerLatexEditing(context, { projects, logger: () => controller.currentServices()?.logger });
  registerWritingValues(context, { projects, logger: () => controller.currentServices()?.logger });
  void projects.reload();
}
