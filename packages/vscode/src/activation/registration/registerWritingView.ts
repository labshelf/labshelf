// Registers the Writing sidebar view with its commands, builds, previews, citations and editing support.
import * as vscode from "vscode";

import type { ILogger, PaperRecord, PaperStatus } from "@labshelf/core";
import {
  WritingProjects, registerMainCommands, registerMainStatusBar, registerProjectCommands,
  registerProjectItemCommands, registerReadingListCommands, ProjectBacklinkIndex, ProjectReadingLists, type WritingHost,
} from "../../writing/index.js";
import {
  BuildDiagnostics, BuildOutcomes, registerBuildCommand, registerCompilerStatusBar, registerLatexWorkshopNotice, registerPickCompiler,
  type ProjectBuilders,
} from "../../writing/build/index.js";
import { registerInstallCommand } from "../../writing/install/index.js";
import { registerEditorActions } from "../../writing/editorActions/index.js";
import { registerMarkVersionCommand } from "../../writing/versions/index.js";
import { registerTinymistBridge } from "../../writing/typst/index.js";
import { BuildPreviews, FocusFollower, registerShowInPreview, registerShowPreview } from "../../writing/preview/index.js";
import { CiteSectionsCache, registerCitationProviders, type CitationWorkspace } from "../../writing/citations/index.js";
import { readCiteSources } from "../../writing/citations/node/index.js";
import { registerLabshelfLinks } from "../../writing/links/index.js";
import { registerProjectSession, type ProjectSession } from "../../writing/session/index.js";
import { registerProjectViews } from "../../writing/tree/index.js";
import type { SidebarProjectsSource } from "../../writing/sidebar/index.js";
import { ProjectFigures, watchFigureFiles } from "../../writing/figures/index.js";
import { registerLatexCommandCompletion, registerLatexEditing } from "../../writing/latexEditing/index.js";
import type { RegisterNodeWriting } from "../../writing/nodePort/index.js";
import { registerWritingValues } from "../../writing/values/index.js";
import { registerBibliographyLint } from "../../writing/bibliography/index.js";
import { arcIcons } from "../../ui/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

/** What other views read from the Writing view: its project list and the backlink index. */
export interface WritingViewHandles {
  projects: WritingProjects;
  /** The list panel reads it to show where papers are cited. */
  backlinks: ProjectBacklinkIndex;
  /** The library sidebar renders it as the Projects section. */
  projectsSource: SidebarProjectsSource;
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

/** Logs to the open library's logger; the project data lives as long as the extension while the library can change. */
function openLibraryLogger(controller: Controller): ILogger {
  const current = (): ILogger | undefined => controller.currentServices()?.logger;
  return {
    log: async (...args) => { await current()?.log(...args); },
    error: async (...args) => { await current()?.error(...args); },
  };
}

function createReadingLists(controller: Controller, backlinks: ProjectBacklinkIndex): ProjectReadingLists {
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
  citeSections: CiteSectionsCache;
}

function registerProjectAndFigureCommands(parts: WritingParts): void {
  const { context, controller, host, projects, figures, readingLists, listPapers } = parts;
  registerProjectCommands({ context, host, projects });
  registerProjectItemCommands({ context, host, projects });
  registerMainCommands({ context, host, projects });
  registerMainStatusBar(context, projects);
  registerReadingListCommands({ context, host, projects, readingLists, listPapers });
  registerInstallCommand({ context, host, projects, services: () => controller.currentServices() });
}

/** Saves the editors and builds a root of the project with the builder of its format, as Build Project does. */
async function recompileRoot(
  projects: WritingProjects, builders: () => ProjectBuilders | undefined, folder: string, root: string,
): Promise<unknown> {
  const entry = projects.list().find((project) => project.kind === "ready" && project.folder === folder);
  const format = entry?.kind === "ready" ? entry.settings.format : undefined;
  if (!format) { return undefined; }
  await vscode.workspace.saveAll(false);
  return await builders()?.[format].request(folder, root, "command");
}

function registerBuildAndPreviewCommands(
  parts: WritingParts, reader: HostAdapters["reader"], registerNodeWriting: RegisterNodeWriting, outcomes: BuildOutcomes,
): { session: ProjectSession; previews: BuildPreviews } {
  const { context, controller, host, projects, figures, listPapers, citeSections } = parts;
  // The node registrations need `previews`, and `previews` needs their builders, so it reaches them through this variable once assigned.
  let node: ReturnType<RegisterNodeWriting> | undefined;
  const previews = new BuildPreviews({
    host, listPapers, citeSections: (project, logger) => citeSections.get(project, logger), paths: projects.paths,
    highlightsOf: async (paperId) => await controller.currentServices()?.paperDataStore.getAnnotations(paperId) ?? [], data: projects.data, extensionUri: context.extensionUri, ...reader,
    buildRootOf: async (...args) => (node ? await node.buildRootOf(...args) : args[1]),
    recompile: (folder, root) => recompileRoot(projects, () => node?.builders, folder, root),
  });
  const session = registerProjectSession({ context, host, projects, previews });
  const diagnostics = new BuildDiagnostics();
  context.subscriptions.push(diagnostics);
  const builds = {
    building: (...args: Parameters<BuildPreviews["building"]>) => { previews.building(...args); outcomes.building(...args); },
    finished: (...args: Parameters<BuildPreviews["finished"]>) => { previews.finished(...args); outcomes.finished(...args); },
    hasPreview: (folder: string) => previews.hasPreview(folder),
  };
  node = registerNodeWriting({ context, host, projects, figures, previews: builds, diagnostics, reader });
  const { builders, buildRootOf } = node;
  registerBuildCommand({ context, projects, builders, buildRootOf });
  context.subscriptions.push(new FocusFollower({ session, projects, buildRootOf, builders, previews, host }));
  registerMarkVersionCommand({ context, host, projects, builders });
  registerTinymistBridge(context, { host, projects });
  registerShowPreview({ context, projects, previews });
  registerShowInPreview({ context, projects, previews });
  registerEditorActions({ context, host });
  registerPickCompiler({ context, host, projects });
  registerCompilerStatusBar(context, projects);
  registerLatexWorkshopNotice({ context, host, projects });
  return { session, previews };
}

function registerEditingSupport(parts: WritingParts): void {
  const { context, controller, projects, citeSections } = parts;
  const session = (): ReturnType<CitationWorkspace["session"]> => {
    const services = controller.currentServices();
    return services ? {
      listPapers: () => services.paperService.listPapers(),
      highlightsOf: (paperId) => services.paperDataStore.getAnnotations(paperId),
      citeSections: (project) => citeSections.get(project, services.logger),
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
  context: vscode.ExtensionContext, controller: LibraryRootController, reader: HostAdapters["reader"],
  adapters: Pick<HostAdapters, "paths" | "createProjectData">,
  registerNodeWriting: RegisterNodeWriting,
): WritingViewHandles {
  const host = createWritingHost(controller);
  const logger = openLibraryLogger(controller);
  const data = adapters.createProjectData(logger);
  const projects = new WritingProjects(host, adapters.paths, data);
  const figures = new ProjectFigures(host, data);
  const backlinks = new ProjectBacklinkIndex(projects, host);
  const readingLists = createReadingLists(controller, backlinks);
  context.subscriptions.push(
    projects,
    figures,
    backlinks,
    watchFigureFiles(projects, () => figures.refresh()),
    controller.onDidChangeRoot(() => void projects.reload()),
  );
  const listPapers = async (): Promise<PaperRecord[]> => await controller.currentServices()?.paperService.listPapers() ?? [];
  const citeSections = new CiteSectionsCache({
    readSources: readCiteSources, onDidSaveTextDocument: vscode.workspace.onDidSaveTextDocument, paths: projects.paths,
  });
  context.subscriptions.push(citeSections);
  const parts: WritingParts = { context, controller, host, projects, figures, readingLists, listPapers, citeSections };
  registerProjectAndFigureCommands(parts);
  const outcomes = new BuildOutcomes();
  context.subscriptions.push(outcomes);
  const { session, previews } = registerBuildAndPreviewCommands(parts, reader, registerNodeWriting, outcomes);
  const arcIcon = arcIcons(context.extensionUri);
  // With no library open every id failed, so the Checklist reports the write as failed.
  const setStatus = async (ids: string[], status: PaperStatus): Promise<string[]> =>
    await controller.currentServices()?.paperService.updatePapersStatus(ids, status) ?? ids;
  const projectsSource = registerProjectViews({
    context, projects, figures, session, logger, arcIcon, readingLists, outcomes, previews, onDidChangeBacklinks: backlinks.onDidChange, setStatus,
  });
  registerEditingSupport(parts);
  void projects.reload();
  return { projects, backlinks, projectsSource };
}
