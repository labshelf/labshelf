// Registers the Writing sidebar view with its commands, builds, previews, citations and editing support.
import * as vscode from "vscode";
import type { SelectionSources } from "../../details/index.js";

import {
  buildRootOf, publishedVersionLookup, type ILogger, type PaperRecord, type PaperStatus, type PathOps, type ProjectLibraryPort, type ProjectDeviceDirs, type PublishedVersionLookup,
} from "@labshelf/core";
import {
  WritingProjects, registerMainCommands, registerMainStatusBar, registerProjectCommands,
  registerProjectItemCommands, registerReadingListCommands, ProjectBacklinkIndex, ProjectReadingLists, type WritingHost,
} from "../../writing/index.js";
import {
  BuildDiagnostics, BuildOutcomes, IncludeOnlyState, registerBuildCommand, registerCompilerStatusBar, registerLatexWorkshopNotice, registerPickCompiler,
  setEngine, type IncludeOnlyTarget, type ProjectBuilders,
} from "../../writing/build/index.js";
import { registerInstallCommand } from "../../writing/install/index.js";
import { registerExportCommands } from "../../writing/export/index.js";
import { registerEditorActions, registerInsertActions } from "../../writing/editorActions/index.js";
import { registerAllProjects } from "../../writing/allProjects/index.js";
import { registerProjectSearch } from "../../writing/search/index.js";
import { registerMarkVersionCommand } from "../../writing/versions/index.js";
import { BuildPreviews, CheckCounts, FocusFollower, registerShowInPreview, registerShowPreview } from "../../writing/preview/index.js";
import { CiteSectionsCache, registerCitationProviders, type CitationWorkspace } from "../../writing/citations/index.js";
import { signalsReader } from "../../writing/checklist/index.js";
import { registerLabshelfLinks } from "../../writing/links/index.js";
import { registerProjectSession, type ProjectSession } from "../../writing/session/index.js";
import { registerProjectViews } from "../../writing/tree/index.js";
import type { ProjectTreeMirror, SidebarProjectsSource } from "../../writing/sidebar/index.js";
import { ProjectFigures, watchFigureFiles } from "../../writing/figures/index.js";
import { registerLatexCommandCompletion, registerLatexEditing } from "../../writing/latexEditing/index.js";
import { createProjectSourceReader } from "../../writing/latexEditing/project/index.js";
import { activeProjectEditor } from "../../writing/preview/roots/index.js";
import type { CitationFixDeps } from "../../writing/preview/citationFixes/index.js";
import type { BuildRootOf, PlatformWriting, RegisterPlatformWriting } from "../../writing/platformPort/index.js";
import { registerWritingValues } from "../../writing/values/index.js";
import { registerBibliographyLint } from "../../writing/bibliography/index.js";
import { arcIcons } from "../../ui/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";
import { openLibraryLogger } from "./openLibraryLogger.js";

/** What other views read from the Writing view: its project list and the backlink index. */
export interface WritingViewHandles {
  projects: WritingProjects;
  readingLists: ProjectReadingLists;
  /** The list panel reads it to show where papers are cited. */
  backlinks: ProjectBacklinkIndex;
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
  includeOnly: IncludeOnlyState;
  includeOnlyTarget: IncludeOnlyTarget;
  publishedLookup: PublishedVersionLookup;
  adapters: WritingAdapters;
}

/** The host values the Writing view reads; `convertDocument` is absent where documents cannot be converted. */
type WritingAdapters = Pick<HostAdapters, "paths" | "uriOf" | "fs" | "createProjectData" | "deviceLayout" | "reader" | "pdfjs" | "convertDocument">;

function registerProjectAndFigureCommands(parts: WritingParts): void {
  const { context, controller, host, projects, figures, readingLists, listPapers, adapters: { convertDocument } } = parts;
  registerProjectCommands({ context, host, projects });
  registerProjectItemCommands({ context, host, projects });
  registerExportCommands({ context, host, projects, ...(convertDocument && { convertDocument }) });
  registerMainCommands({ context, host, projects });
  registerMainStatusBar(context, projects);
  registerReadingListCommands({ context, host, projects, readingLists, listPapers });
  registerInstallCommand({ context, host, projects, services: () => controller.currentServices() });
}

/** Saves the editors and builds a root of the project with the builder of its format, as Build Project does. */
async function recompileRoot(
  projects: WritingProjects, builders: () => ProjectBuilders | undefined, includeOnlyTarget: IncludeOnlyTarget, folder: string, root: string,
): Promise<unknown> {
  const entry = projects.list().find((project) => project.kind === "ready" && project.folder === folder);
  if (entry?.kind !== "ready") { return undefined; }
  const format = entry.settings.format;
  await vscode.workspace.saveAll(false);
  return await builders()?.[format].request(folder, root, "command", await includeOnlyTarget(entry, root));
}

/** What the preview's citation cards need to fix a citation, while a library is open. */
function citationFixDeps(
  controller: Controller, listPapers: () => Promise<PaperRecord[]>, publishedLookup: PublishedVersionLookup, projectFolder: string, paths: PathOps,
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
  const diagnostics = new BuildDiagnostics();
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
  registerLabshelfLinks(context, { session });
  registerLatexCommandCompletion(context);
  registerLatexEditing(context, { projects, logger });
  registerWritingValues(context, { projects, logger });
  registerBibliographyLint(context, { logger });
}

function createIncludeOnly(
  controller: LibraryRootController, projects: WritingProjects,
): { includeOnly: IncludeOnlyState; includeOnlyTarget: IncludeOnlyTarget } {
  const includeOnly = new IncludeOnlyState({
    readerFor: (folder) => createProjectSourceReader(vscode.Uri.file(folder), () => controller.currentServices()?.logger),
  });
  const includeOnlyTarget: IncludeOnlyTarget = async (project, root) => {
    const editor = activeProjectEditor(projects.paths, project.folder);
    if (!editor) { return undefined; }
    const focused = projects.paths.relative(project.folder, editor.document.uri.fsPath).split(projects.paths.sep).join("/");
    return includeOnly.target(project, root, focused);
  };
  return { includeOnly, includeOnlyTarget };
}

export function registerWritingView(
  context: vscode.ExtensionContext, controller: LibraryRootController, adapters: WritingAdapters,
  registerPlatformWriting: RegisterPlatformWriting, sources: Pick<SelectionSources, "projectSelected" | "projectsActivated">,
): WritingViewHandles {
  const host = createWritingHost(controller);
  const logger = openLibraryLogger(controller);
  const data = adapters.createProjectData(logger, openLibraryDeviceDirs(controller, adapters.deviceLayout));
  const projects = new WritingProjects(host, adapters.paths, adapters.fs, data);
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
  const readSignals = signalsReader(projects);
  const citeSections = new CiteSectionsCache({
    readSources: async (project, siteLogger) => (await readSignals(project, siteLogger)).sources,
    onDidSaveTextDocument: vscode.workspace.onDidSaveTextDocument, paths: projects.paths,
  });
  context.subscriptions.push(citeSections);
  const { includeOnly, includeOnlyTarget } = createIncludeOnly(controller, projects);
  const publishedLookup = publishedVersionLookup({ fetch: globalThis.fetch, get logger() { return logger; } });
  const parts: WritingParts = {
    context, controller, host, projects, figures, readingLists, listPapers, citeSections, includeOnly, includeOnlyTarget, publishedLookup, adapters,
  };
  registerProjectAndFigureCommands(parts);
  const outcomes = new BuildOutcomes();
  context.subscriptions.push(outcomes);
  const { session, previews, recompile } = registerBuildAndPreviewCommands(parts, registerPlatformWriting, outcomes);
  const arcIcon = arcIcons(context.extensionUri);
  // With no library open every id failed, so the Checklist reports the write as failed.
  const setStatus = async (ids: string[], status: PaperStatus): Promise<string[]> =>
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
