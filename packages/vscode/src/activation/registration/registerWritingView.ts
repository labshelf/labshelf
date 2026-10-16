// Registers the Writing sidebar view with its commands, builds, previews, citations and editing support.
import * as vscode from "vscode";

import type { ILogger, PaperRecord } from "@labshelf/core";
import {
  WritingProjects, WritingTreeProvider, registerMainCommands, registerMainStatusBar, registerProjectCommands,
  registerProjectItemCommands, registerReadingListCommands, ProjectBacklinkIndex, ProjectReadingLists, type WritingHost,
} from "../../writing/index.js";
import {
  BuildDiagnostics, registerBuildCommand, registerCompilerStatusBar, registerLatexBuild, registerLatexWorkshopNotice, registerPickCompiler,
} from "../../writing/build/index.js";
import { registerCheckCommand } from "../../writing/check/index.js";
import { registerInstallCommand } from "../../writing/install/index.js";
import { registerCompareVersionsCommand, registerMarkVersionCommand } from "../../writing/versions/index.js";
import { hostPdfjs } from "../../pdf/node/index.js";
import { registerTinymistBridge, registerTypstBuild } from "../../writing/typst/index.js";
import { BuildPreviews, registerShowInPreview, registerShowPreview } from "../../writing/preview/index.js";
import { registerCitationProviders, type CitationWorkspace } from "../../writing/citations/index.js";
import { registerLabshelfLinks } from "../../writing/links/index.js";
import { ProjectFigures, registerRegenerateFigure, watchFigureFiles } from "../../writing/figures/index.js";
import { registerLatexCommandCompletion, registerLatexEditing } from "../../writing/latexEditing/index.js";
import { registerWritingValues } from "../../writing/values/index.js";
import { registerBibliographyLint } from "../../writing/bibliography/index.js";
import { onPaperChange, type LibraryEvents } from "../../events/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

/** What other views read from the Writing view: its project list and the backlink index. */
export interface WritingViewHandles {
  projects: WritingProjects;
  /** The list panel reads it to show where papers are cited. */
  backlinks: ProjectBacklinkIndex;
}

type Controller = LibraryRootController;

function createWritingHost(controller: Controller): WritingHost {
  const current = (): ReturnType<WritingHost["current"]> => {
    const root = controller.currentRoot();
    const services = controller.currentServices();
    return root && services ? { root: root.fsPath, logger: services.logger } : undefined;
  };
  return {
    current,
    // Offers the library setup when none is configured.
    require: async () => { await controller.require(); return current(); },
  };
}

function createReadingLists(
  controller: Controller, events: LibraryEvents, backlinks: ProjectBacklinkIndex,
): ProjectReadingLists {
  return new ProjectReadingLists({
    backlinks,
    session: () => {
      const services = controller.currentServices();
      return services ? {
        listPapers: () => services.paperService.listPapers(),
        isOpened: async (paperId) => (await services.paperDataStore.getReadingState(paperId)) !== null,
        logger: services.logger,
      } : undefined;
    },
    onPapersChange: (listener) => onPaperChange(events, listener),
  });
}

interface WritingParts {
  context: vscode.ExtensionContext;
  controller: Controller;
  host: WritingHost;
  projects: WritingProjects;
  figures: ProjectFigures;
  readingLists: ProjectReadingLists;
  listPapers: () => Promise<PaperRecord[]>;
}

function registerProjectAndFigureCommands(parts: WritingParts): void {
  const { context, controller, host, projects, figures, readingLists, listPapers } = parts;
  registerProjectCommands({ context, host, projects });
  registerProjectItemCommands({ context, host, projects });
  registerMainCommands({ context, host, projects });
  registerMainStatusBar(context, projects);
  const figureOutput = vscode.window.createOutputChannel("LabShelf Figures");
  context.subscriptions.push(figureOutput);
  registerRegenerateFigure({ context, host, figures, output: figureOutput });
  registerReadingListCommands({ context, host, projects, readingLists, listPapers });
  registerInstallCommand({ context, host, projects, services: () => controller.currentServices() });
}

function registerBuildAndPreviewCommands(parts: WritingParts, reader: HostAdapters["reader"]): void {
  const { context, host, projects, listPapers } = parts;
  const previews = new BuildPreviews({ host, listPapers, paths: projects.paths, extensionUri: context.extensionUri, ...reader });
  const diagnostics = new BuildDiagnostics();
  context.subscriptions.push(diagnostics);
  const builders = {
    latex: registerLatexBuild({ context, host, projects, previews, diagnostics }),
    typst: registerTypstBuild({ context, host, projects, previews, diagnostics, hasPreview: (folder) => previews.hasPreview(folder) }),
  };
  registerBuildCommand({ context, projects, builders });
  registerCheckCommand({ context, host, projects, builders, pdfjs: hostPdfjs });
  registerMarkVersionCommand({ context, host, projects, builders });
  registerCompareVersionsCommand({ context, host, projects, builders, pdfjs: hostPdfjs, reader });
  registerTinymistBridge(context, { host, projects });
  registerShowPreview({ context, projects, previews });
  registerShowInPreview({ context, projects, previews });
  registerPickCompiler({ context, host, projects });
  registerCompilerStatusBar(context, projects);
  registerLatexWorkshopNotice({ context, host, projects });
}

function registerEditingSupport(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): void {
  const session = (): ReturnType<CitationWorkspace["session"]> => {
    const services = controller.currentServices();
    return services ? {
      listPapers: () => services.paperService.listPapers(),
      highlightsOf: (paperId) => services.paperDataStore.getAnnotations(paperId),
      logger: services.logger,
    } : undefined;
  };
  const logger = (): ILogger | undefined => controller.currentServices()?.logger;
  registerCitationProviders(context, { projects, session });
  registerLabshelfLinks(context, { session });
  registerLatexCommandCompletion(context);
  registerLatexEditing(context, { projects, logger });
  registerWritingValues(context, { projects, logger });
  registerBibliographyLint(context, { logger });
}

export function registerWritingView(
  context: vscode.ExtensionContext, controller: LibraryRootController, reader: HostAdapters["reader"], paths: HostAdapters["paths"], events: LibraryEvents,
): WritingViewHandles {
  const host = createWritingHost(controller);
  const projects = new WritingProjects(host, paths);
  const figures = new ProjectFigures(host);
  const backlinks = new ProjectBacklinkIndex(projects, host);
  const readingLists = createReadingLists(controller, events, backlinks);
  const provider = new WritingTreeProvider(projects, figures, readingLists);
  context.subscriptions.push(
    projects,
    figures,
    backlinks,
    readingLists,
    provider,
    watchFigureFiles(projects, () => figures.refresh()),
    vscode.window.createTreeView("labshelf.writing", { treeDataProvider: provider }),
    controller.onDidChangeRoot(() => void projects.reload()),
  );
  const listPapers = async (): Promise<PaperRecord[]> => await controller.currentServices()?.paperService.listPapers() ?? [];
  const parts: WritingParts = { context, controller, host, projects, figures, readingLists, listPapers };
  registerProjectAndFigureCommands(parts);
  registerBuildAndPreviewCommands(parts, reader);
  registerEditingSupport(context, controller, projects);
  void projects.reload();
  return { projects, backlinks };
}
