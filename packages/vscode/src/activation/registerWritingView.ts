// Registers the Writing sidebar view with its commands, builds, previews, citations and editing support.
import * as vscode from "vscode";
import type { SelectionSources } from "../libraryUi/details/index.js";

import {
  buildRootOf, createPublishedVersionFinder, type ILogger, type PaperRecord, type ReadingStatus, type PathOps, type ProjectLibraryPort, type ProjectDeviceDirs, type PublishedVersionFinder,
} from "@labshelf/core";
import {
  WritingProjects, registerBuildRootCommands, registerBuildRootStatusBar, registerProjectCommands,
  registerProjectItemCommands, registerReadingListCommands, ProjectBacklinks, ProjectReadingLists, type WritingHost,
} from "../writing/index.js";
import {
  BuildProblems, BuildOutcomes, IncludeOnlyState, registerBuildCommand, registerCompilerStatusBar, registerLatexWorkshopNotice, registerPickCompiler,
  setEngine, type FindIncludeOnly, type ProjectBuilders,
} from "../writing/build/index.js";
import { registerInstallCommand } from "../writing/index.js";
import { registerExportCommands } from "../writing/index.js";
import { registerEditorActions, registerInsertActions } from "../writing/index.js";
import { registerAllProjects } from "../writing/allProjects/index.js";
import { registerProjectSearch } from "../writing/search/index.js";
import { registerMarkVersionCommand } from "../writing/history/index.js";
import { BuildPreviews, CheckCounts, FocusFollower, registerShowInPreview, registerShowPreview } from "../writing/preview/index.js";
import { CitationSectionsCache, registerCitationProviders, type CitationWorkspace } from "../writing/citations/index.js";
import { createSignalsReader } from "../writing/checklist/index.js";
import { registerPaperLinks } from "../writing/index.js";
import { registerProjectSession, type ProjectSession } from "../writing/session/index.js";
import { registerProjectViews } from "../writing/tree/index.js";
import type { ProjectTreeMirror, SidebarProjectsSource } from "../writing/sidebar/index.js";
import { ProjectFigures, watchFigureFiles } from "../writing/figures/index.js";
import { registerLatexCommandCompletion, registerLatexEditing } from "../latex/index.js";
import { createProjectSourceReader } from "../latex/project/index.js";
import { readActiveProjectEditor } from "../writing/preview/buildRoot/index.js";
import type { CitationFixDeps } from "../writing/preview/citations/index.js";
import type { BuildRootOf, PlatformWriting, RegisterPlatformWriting } from "../writing/index.js";
import { registerProjectValues } from "../writing/projectValue/index.js";
import { registerBibliographyCheck } from "../writing/index.js";
import { createArcIcons } from "../ui/index.js";
import type { LibraryRootController } from "./libraryRootController.js";
import { registerProjectWriteEvents } from "../writing/session/index.js";
import type { HostAdapters } from "./hostAdapters.js";
import { openLibraryLogger } from "./openLibraryLogger.js";

/** What other views read from the Writing view: its project list and the backlink index. */
export interface WritingViewResult {
  projects: WritingProjects;
  readingLists: ProjectReadingLists;
  /** The list panel reads it to show where papers are cited. */
  backlinks: ProjectBacklinks;
  /** The library sidebar renders it as the Projects section. */
  projectsSource: SidebarProjectsSource;
  /** The library sidebar renders the open project's Files, Outline and Checklist from it. */
  projectTrees: ProjectTreeMirror;
  /** The Details view serves the All projects protocol from the same port. */
  projectLibrary: () => ProjectLibraryPort;
  logger: ILogger;
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

/** Names the open library's device folders at every read, since the library root can change. */
function openLibraryDeviceDirs(controller: Controller, deviceLayout: HostAdapters["deviceLayout"]): ProjectDeviceDirs {
  const current = (): ProjectDeviceDirs => {
    const root = controller.currentRoot();
    if (!root) { throw new Error("No library is open, so the project folders have no device-local place"); }
    return deviceLayout(root.fsPath);
  };
  return {
    get projectRegistryPath() { return current().projectRegistryPath; },
    get buildCacheDir() { return current().buildCacheDir; },
    get mergeBasesDir() { return current().mergeBasesDir; },
  };
}

function createReadingLists(controller: Controller, backlinks: ProjectBacklinks): ProjectReadingLists {
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
  citeSections: CitationSectionsCache;
  includeOnly: IncludeOnlyState;
  includeOnlyTarget: FindIncludeOnly;
  publishedLookup: PublishedVersionFinder;
  adapters: WritingAdapters;
}

/** The host values the Writing view reads; `convertDocument` is absent where documents cannot be converted. */
type WritingAdapters = Pick<HostAdapters, "paths" | "uriOf" | "fs" | "createProjectWriteTracking" | "createProjectData" | "deviceLayout" | "reader" | "pdfjs" | "convertDocument">;

function registerProjectAndFigureCommands(parts: WritingParts): void {
  const { context, controller, host, projects, readingLists, listPapers, adapters: { convertDocument } } = parts;
  registerProjectCommands({ context, host, projects });
  registerProjectItemCommands({ context, host, projects });
  registerExportCommands({ context, host, projects, ...(convertDocument && { convertDocument }) });
  registerBuildRootCommands({ context, host, projects });
  registerBuildRootStatusBar(context, projects);
  registerReadingListCommands({ context, host, projects, readingLists, listPapers });
  registerInstallCommand({ context, host, projects, services: () => controller.currentServices() });
}

/** Saves the editors and builds a root of the project with the builder of its format, as Build Project does. */
async function recompileRoot(
  projects: WritingProjects, builders: () => ProjectBuilders | undefined, includeOnlyTarget: FindIncludeOnly, folder: string, root: string,
): Promise<unknown> {
  const entry = projects.list().find((project) => project.kind === "ready" && project.folder === folder);
  if (entry?.kind !== "ready") { return undefined; }
  const format = entry.settings.format;
  await vscode.workspace.saveAll(false);
  return await builders()?.[format].request(folder, root, "command", await includeOnlyTarget(entry, root));
}

/** What the preview's citation cards need to fix a citation, while a library is open. */
function citationFixDeps(
  controller: Controller, listPapers: () => Promise<PaperRecord[]>, publishedLookup: PublishedVersionFinder, projectFolder: string, paths: PathOps,
): CitationFixDeps | undefined {
  const services = controller.currentServices();
  if (!services) { return undefined; }
  return {
    projectFolder, paths, logger: services.logger, publishedLookup, importer: services.importer, ctx: services.mutations,
    reindex: services.reindexLibrary, takenIds: () => [...services.library.snapshot.papers.keys()],
    shelfKeys: async () => (await listPapers()).map((paper) => ({
      key: paper.citeKey, authors: paper.authors ?? [], ...(paper.year !== undefined ? { year: String(paper.year) } : {}),
    })),
  };
}

function registerBuildAndPreviewCommands(
  parts: WritingParts, registerPlatformWriting: RegisterPlatformWriting, outcomes: BuildOutcomes,
): { session: ProjectSession; previews: BuildPreviews; recompile: (folder: string, root: string) => Promise<unknown> } {
  const { context, controller, host, projects, figures, listPapers, includeOnly, includeOnlyTarget, publishedLookup, adapters: { reader, uriOf } } = parts;
  // The platform registrations need `previews`, and `previews` needs their builders, so it reaches them through this variable once assigned.
  let platform: PlatformWriting | undefined;
  const counts = new CheckCounts();
  const recompile = (folder: string, root: string): Promise<unknown> => recompileRoot(projects, () => platform?.builders, includeOnlyTarget, folder, root);
  const rootOf: BuildRootOf = (folder, main, file) => buildRootOf(projects, folder, main, file);
  const previews = new BuildPreviews({
    host, listPapers, paths: projects.paths, uriOf,
    highlightsOf: async (paperId) => await controller.currentServices()?.paperDataStore.getAnnotations(paperId) ?? [], data: projects.data, extensionUri: context.extensionUri, ...reader,
    buildRootOf: rootOf,
    recompile,
    projects, checkCounts: counts, includeOnly,
    setEngine: async (project, engine) => { await setEngine({ host, projects }, project, engine); },
    fixes: (projectFolder) => citationFixDeps(controller, listPapers, publishedLookup, projectFolder, projects.paths),
  });
  const session = registerProjectSession({ context, host, projects, previews });
  const diagnostics = new BuildProblems();
  context.subscriptions.push(diagnostics);
  const builds = {
    building: (...args: Parameters<BuildPreviews["building"]>) => { previews.building(...args); outcomes.building(...args); },
    finished: (...args: Parameters<BuildPreviews["finished"]>) => { previews.finished(...args); outcomes.finished(...args); },
    hasPreview: (folder: string) => previews.hasPreview(folder),
  };
  platform = registerPlatformWriting({ context, host, projects, figures, previews: builds, diagnostics, reader, onFindings: (folder, count) => counts.record(folder, count), includeOnlyTarget });
  const { builders, history } = platform;
  registerBuildCommand({ context, projects, builders, buildRootOf: rootOf });
  context.subscriptions.push(new FocusFollower({ session, projects, buildRootOf: rootOf, builders, previews, host }));
  registerMarkVersionCommand({ context, host, projects, builders, onMarked: (project, name) => history?.recordVersion(project, name) });
  registerShowPreview({ context, projects, previews });
  registerShowInPreview({ context, projects, previews });
  registerEditorActions({ context, host });
  registerInsertActions({ context, host, projects });
  registerProjectSearch({ context, projects, host });
  registerPickCompiler({ context, host, projects });
  registerCompilerStatusBar(context, projects);
  registerLatexWorkshopNotice({ context, host, projects });
  return { session, previews, recompile };
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
  registerPaperLinks(context, { session });
  registerLatexCommandCompletion(context);
  registerLatexEditing(context, { projects, logger });
  registerProjectValues(context, { projects, logger });
  registerBibliographyCheck(context, { logger });
}

function createIncludeOnly(
  controller: LibraryRootController, projects: WritingProjects,
): { includeOnly: IncludeOnlyState; includeOnlyTarget: FindIncludeOnly } {
  const includeOnly = new IncludeOnlyState({
    readerFor: (folder) => createProjectSourceReader(vscode.Uri.file(folder), () => controller.currentServices()?.logger),
  });
  const includeOnlyTarget: FindIncludeOnly = async (project, root) => {
    const editor = readActiveProjectEditor(projects.paths, project.folder);
    if (!editor) { return undefined; }
    const focused = projects.paths.relative(project.folder, editor.document.uri.fsPath).split(projects.paths.sep).join("/");
    return includeOnly.target(project, root, focused);
  };
  return { includeOnly, includeOnlyTarget };
}

function createTrackedProjects(
  context: vscode.ExtensionContext, controller: LibraryRootController, adapters: WritingAdapters,
  host: WritingHost, logger: ILogger,
) {
  const saves = adapters.createProjectWriteTracking(() => host.current()?.root, logger);
  const data = adapters.createProjectData(logger, openLibraryDeviceDirs(controller, adapters.deviceLayout), saves.fs);
  const projects = new WritingProjects(host, adapters.paths, saves.fs, data);
  registerProjectWriteEvents(context, saves, logger);
  return { projects, data };
}

export function registerWritingView(
  context: vscode.ExtensionContext, controller: LibraryRootController, adapters: WritingAdapters,
  registerPlatformWriting: RegisterPlatformWriting, sources: Pick<SelectionSources, "projectSelected" | "projectsActivated">,
): WritingViewResult {
  const host = createWritingHost(controller);
  const logger = openLibraryLogger(controller);
  const { projects, data } = createTrackedProjects(context, controller, adapters, host, logger);
  const figures = new ProjectFigures(host, data);
  const backlinks = new ProjectBacklinks(projects, host);
  const readingLists = createReadingLists(controller, backlinks);
  context.subscriptions.push(
    projects,
    figures,
    backlinks,
    watchFigureFiles(projects, () => figures.refresh()),
    controller.onDidChangeRoot(() => void projects.reload()),
  );
  const listPapers = async (): Promise<PaperRecord[]> => await controller.currentServices()?.paperService.listPapers() ?? [];
  const readSignals = createSignalsReader(projects);
  const citeSections = new CitationSectionsCache({
    readSources: async (project, siteLogger) => (await readSignals(project, siteLogger)).sources,
    onDidSaveTextDocument: vscode.workspace.onDidSaveTextDocument, paths: projects.paths,
  });
  context.subscriptions.push(citeSections);
  const { includeOnly, includeOnlyTarget } = createIncludeOnly(controller, projects);
  const publishedLookup = createPublishedVersionFinder({ fetch: globalThis.fetch, get logger() { return logger; } });
  const parts: WritingParts = {
    context, controller, host, projects, figures, readingLists, listPapers, citeSections, includeOnly, includeOnlyTarget, publishedLookup, adapters,
  };
  registerProjectAndFigureCommands(parts);
  const outcomes = new BuildOutcomes();
  context.subscriptions.push(outcomes);
  const { session, previews, recompile } = registerBuildAndPreviewCommands(parts, registerPlatformWriting, outcomes);
  const arcIcon = createArcIcons(context.extensionUri);
  // With no library open every id failed, so the Checklist reports the write as failed.
  const setStatus = async (ids: string[], status: ReadingStatus): Promise<string[]> =>
    await controller.currentServices()?.paperService.updatePapersStatus(ids, status) ?? ids;
  const { projectsSource, projectTrees } = registerProjectViews({
    context, projects, figures, session, logger, arcIcon, readingLists, outcomes, previews, onDidChangeBacklinks: backlinks.onDidChange, setStatus,
  });
  const projectLibrary = registerAllProjects({
    context, host, projects, session, source: projectsSource, logger, outcomes, builds: previews.builds,
    onDidChangeRootBuild: previews.onDidChangeRootBuild, listPapers, pdfjs: adapters.pdfjs, recompile,
    selection: { onSelect: sources.projectSelected, onActivate: sources.projectsActivated },
  });
  registerEditingSupport(parts);
  void projects.reload();
  return { projects, readingLists, backlinks, projectsSource, projectTrees, projectLibrary, logger };
}
