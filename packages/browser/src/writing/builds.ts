// Follows the builds of a project on its preview frame, and answers the requests the frame sends.
import {
  checkPreviewRequest,
  createBuildRootsMessage,
  deriveCheckLimitsPatch,
  createListeners,
  derivePreviewProblems,
  type BuildOptions,
  type BuildSchedule,
  type HostToWebview,
  type ILogger,
  type LatexEngine,
  type LibraryFileSystem,
  type PreviewBuildRoots,
  type PreviewLimits,
  type PreviewRequest,
  type ProjectContentPort,
} from "@labshelf/core";
import type { BuildKind, HelperCompileResult } from "@labshelf/core/helper";
import type { Workspace } from "../libraryUi/editorArea";
import type { ExtensionSettings } from "../platform";
import { writeProjectVersion } from "./history";
import { showInOpenEditor } from "./session";

const READER_PAGE = "../reader/index.html";

type PreviewBuildState = Omit<Extract<HostToWebview, { type: "buildStatus" }>, "type">;
type PreviewFrameMessage = Extract<HostToWebview, { type: "reloadDocument" | "buildStatus" | "previewRoots" }>;

export interface PreviewFrame {
  readonly element: HTMLIFrameElement;
  showPdf(bytes: Uint8Array): void;
  setBuildStatus(status: PreviewBuildState): void;
  setPreviewRoots(roots: PreviewBuildRoots): void;
  /** Calls `listener` with each well-formed request the embedded reader sends; returns the unsubscribe. */
  onRequest(listener: (request: PreviewRequest) => void): () => void;
  /** Removes the iframe and frees the PDFs it handed over. */
  dispose(): void;
}

function previewReaderUrl(projectId: string, title: string): string {
  const query = new URLSearchParams({ preview: "1", project: projectId, title });
  return `${READER_PAGE}?${query.toString()}`;
}

export function createPreviewFrame(container: HTMLElement, project: { id: string; title: string }): PreviewFrame {
  const element = document.createElement("iframe");
  element.className = "ls-preview-frame";
  element.title = project.title;
  const messages = createFrameMessages(element);
  const urls: string[] = [];
  const listeners = createListeners<PreviewRequest>();
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin || event.source === null || event.source !== element.contentWindow) return;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || checkPreviewRequest(data as Record<string, unknown>) !== true) return;
    listeners.emit(data as PreviewRequest);
  };
  window.addEventListener("message", onMessage);
  container.append(element);
  // PLATFORM: Chrome takes an iframe document's prefers-color-scheme from its owner element, so a src set before append boots the reader light under a dark page.
  element.src = previewReaderUrl(project.id, project.title);

  return {
    element,
    showPdf(bytes) {
      // TRAP: the reader may still be fetching the previous URL when the next PDF arrives, so a URL is revoked only when a third one replaces it.
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      urls.push(url);
      if (urls.length > 2) URL.revokeObjectURL(urls.shift()!);
      messages.post({ type: "reloadDocument", pdfUrl: url });
    },
    setBuildStatus(status) {
      messages.post({ type: "buildStatus", ...status });
    },
    setPreviewRoots(roots) {
      messages.post({ type: "previewRoots", roots });
    },
    onRequest: (listener) => listeners.add(listener),
    dispose() {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      messages.dispose();
      listeners.clear();
      window.removeEventListener("message", onMessage);
      element.remove();
    },
  };
}

function createFrameMessages(element: HTMLIFrameElement) {
  let loaded = false;
  // PLATFORM: messages sent before load reach about:blank; only the latest state can reference a live PDF URL.
  const held = new Map<PreviewFrameMessage["type"], PreviewFrameMessage>();
  const post = (message: PreviewFrameMessage): void => {
    if (!loaded) { held.set(message.type, message); return; }
    element.contentWindow?.postMessage(message, location.origin);
  };
  const onLoad = (): void => {
    loaded = true;
    for (const message of held.values()) post(message);
    held.clear();
  };
  element.addEventListener("load", onLoad);
  return { post, dispose() { held.clear(); element.removeEventListener("load", onLoad); } };
}

export type PreviewBuildEvent = { type: "building" } | { type: "pdf"; bytes: Uint8Array; mode: BuildKind } | { type: "result"; result: HelperCompileResult };

export interface PreviewBuildSource {
  build(projectId: string): Promise<unknown>;
  onBuild(listener: (event: PreviewBuildEvent) => void): () => void;
}

function statusOf(result: HelperCompileResult): PreviewBuildState {
  switch (result.status) {
    case "succeeded": return { state: "succeeded", errors: 0, builtAt: Date.now() };
    case "cancelled": return { state: "failed", errors: 0, stale: true };
    default: return { state: "failed", errors: Math.max(1, result.problems.length) };
  }
}

function rootsOf(main: string, result: HelperCompileResult, limits: PreviewLimits, options: BuildOptions | undefined): PreviewBuildRoots {
  // The helper builds only the main file and keeps no raw log or source map the page can open.
  const root = { path: main, failed: result.status !== "succeeded", rawLog: false, sourceLinks: false, problems: derivePreviewProblems(result.problems) };
  return createBuildRootsMessage({ main, focused: main, shown: main, roots: [root], limits, options: options !== undefined ? { ...options } : undefined });
}

export interface FollowedBuilds {
  /** The roots last posted to the frame. */
  roots(): PreviewBuildRoots | undefined;
  /** Posts the last roots again with the project's current limits and build options. */
  resendRoots(): void;
  dispose(): void;
}

/** Starts a build and keeps the frame in step with every build until disposed. */
export function watchBuilds(
  source: PreviewBuildSource, frame: Pick<PreviewFrame, "showPdf" | "setBuildStatus" | "setPreviewRoots">,
  project: { id: string; main: string | undefined; limits?: () => PreviewLimits; options?: () => BuildOptions }, logger: ILogger,
): FollowedBuilds {
  let disposed = false;
  let last: HelperCompileResult | undefined;
  let posted: PreviewBuildRoots | undefined;
  const post = (): void => {
    if (last === undefined || project.main === undefined) return;
    posted = rootsOf(project.main, last, project.limits?.() ?? {}, project.options?.());
    frame.setPreviewRoots(posted);
  };
  const off = source.onBuild((event) => {
    if (disposed) return;
    if (event.type === "building") frame.setBuildStatus({ state: "building", errors: 0 });
    else if (event.type === "pdf") frame.showPdf(event.bytes);
    else {
      frame.setBuildStatus(statusOf(event.result));
      // A cancelled build has no problems of its own, so the roots of the last finished build stay; a project without a main file has no root to show.
      if (event.result.status !== "cancelled") { last = event.result; post(); }
    }
  });
  source.build(project.id).catch(async (error: unknown) => {
    await logger.error("preview", error, { action: "build", projectId: project.id });
    if (!disposed) frame.setBuildStatus({ state: "failed", errors: 1 });
  });

  return { roots: () => posted, resendRoots: post, dispose() { disposed = true; off(); } };
}

const MODULE = "writing.preview";

export interface PreviewRequestDeps {
  /** `folder` is absent while the project is not open on the page, so nothing is written for it. */
  project: { id: string; folder: string | undefined };
  fs: LibraryFileSystem;
  logger: ILogger;
  workspace: Pick<Workspace, "openTab">;
  helperProject: {
    build(projectId: string): Promise<unknown>;
    lastFullPdf(projectId: string): Uint8Array | undefined;
    setBuild(projectId: string, patch: { autoCompile?: BuildSchedule; engine?: LatexEngine; haltOnError?: boolean }): void;
  };
  data: Pick<ProjectContentPort, "updateProjectSettings">;
  builds: Pick<FollowedBuilds, "roots" | "resendRoots">;
  /** The limits the roots carry; a saved change updates them. */
  limits: PreviewLimits;
  /** The build options the roots carry; a saved change updates them. */
  options: BuildOptions;
  updateSettings(patch: Partial<Pick<ExtensionSettings, "autoCompile" | "haltOnError">>): Promise<void>;
}

async function openProblem({ project, logger, workspace, builds }: PreviewRequestDeps, root: string, index: number): Promise<void> {
  const problem = builds.roots()?.roots.find((candidate) => candidate.path === root)?.problems[index];
  if (!problem?.file) {
    await logger.log("WARN", MODULE, "No source to open for the problem", { projectId: project.id, root, index });
    return;
  }
  workspace.openTab("source", { projectId: project.id, path: problem.file }, 0);
  // Problem lines count from 1; the editor reveals zero-based lines.
  showInOpenEditor(project.id, problem.file, Math.max(0, (problem.line ?? 1) - 1));
}

async function saveLimits(deps: PreviewRequestDeps, folder: string, change: Extract<PreviewRequest, { command: "setCheckLimits" }>["limits"]): Promise<void> {
  const check = deriveCheckLimitsPatch(change);
  await deps.data.updateProjectSettings(folder, { check });
  Object.assign(deps.limits, check);
  deps.builds.resendRoots();
}

/** Saves a per-user build setting, then applies it to the open build. */
async function saveUserOption(deps: PreviewRequestDeps, patch: { autoCompile: BuildSchedule } | { haltOnError: boolean }): Promise<void> {
  await deps.updateSettings(patch);
  Object.assign(deps.options, patch);
  deps.helperProject.setBuild(deps.project.id, patch);
  deps.builds.resendRoots();
  await deps.logger.log("INFO", MODULE, "Saved a build setting", { projectId: deps.project.id, ...patch });
}

async function saveEngine(deps: PreviewRequestDeps, folder: string, engine: LatexEngine): Promise<void> {
  await deps.data.updateProjectSettings(folder, { engine });
  deps.options.engine = engine;
  deps.helperProject.setBuild(deps.project.id, { engine });
  deps.builds.resendRoots();
  await deps.logger.log("INFO", MODULE, "Saved the project's LaTeX engine", { projectId: deps.project.id, engine });
}

async function answer(deps: PreviewRequestDeps, request: PreviewRequest): Promise<void> {
  const { project, logger } = deps;
  const folder = project.folder;
  const writes = request.command === "setCheckLimits" || request.command === "setEngine" || (request.command === "runCommand" && request.id === "markVersion");
  if (writes && folder === undefined) await logger.log("WARN", MODULE, "The preview's project is not open, so nothing was written", { command: request.command, projectId: project.id });
  else if (request.command === "recompile") await deps.helperProject.build(project.id);
  else if (request.command === "openProblem") await openProblem(deps, request.root, request.index);
  else if (request.command === "setCheckLimits") await saveLimits(deps, folder as string, request.limits);
  else if (request.command === "setEngine") await saveEngine(deps, folder as string, request.engine);
  else if (request.command === "setAutoCompile") await saveUserOption(deps, { autoCompile: request.mode });
  else if (request.command === "setHaltOnError") await saveUserOption(deps, { haltOnError: request.on });
  else if (request.command === "runCommand" && request.id === "markVersion") await writeProjectVersion({ fs: deps.fs, logger, lastFullPdf: deps.helperProject.lastFullPdf }, { id: project.id, folder: folder as string });
  // The history tab lists the versions to compare.
  else if (request.command === "runCommand" && request.id === "compareVersions") deps.workspace.openTab("history", { projectId: project.id }, 1);
  else await logger.log("WARN", MODULE, "the library page does not handle this preview request", { command: request.command, projectId: project.id });
}

/** @returns the frame's request listener; a failed request is logged with its command. */
export function createPreviewRequestHandler(deps: PreviewRequestDeps): (request: PreviewRequest) => void {
  return (request) => {
    answer(deps, request).catch((error: unknown) => deps.logger.error(MODULE, error, { action: request.command, projectId: deps.project.id }));
  };
}
