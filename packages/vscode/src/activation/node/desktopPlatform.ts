// Builds the desktop platform: Node adapters, the Node Writing registrations, the library flows over the user's disk, the sharing host and the cell hosts.
import * as vscode from "vscode";

import { registerCollab } from "../../collab/node/index.js";
import { nodeSharedLibraryConfig, pickLibraryRoot, offerLibraryMove, runMoveLibraryCommand } from "../../library/node/index.js";
import { registerShareLinks } from "../../share/node/index.js";
import { sharingWebviews } from "../../share/index.js";
import { createVscodeShareHost, serveShareOn } from "../../share/node/index.js";
import { createSessionLogger, createVscodeTex, registerCheckCommand, registerLatexBuild } from "../../writing/build/node/index.js";
import { registerDeckExport } from "./exportDeck.js";
import { registerRegenerateFigure } from "../../writing/projects/node/index.js";
import { registerAddExistingFolder, registerTypstLanguage, type RegisterPlatformWriting } from "../../writing/projects/index.js";
import { registerTemplates } from "../../writing/templates/node/index.js";
import { registerTypstBuild } from "../../writing/typst/node/index.js";
import { registerCompareVersionsCommand, registerProjectHistory } from "../../writing/history/node/index.js";
import { createNodeDictionaryStore, createStylePreviewHandler } from "../../writing/sourceEditor/node/index.js";
import type { CellHosts, ExtensionPlatform } from "../extensionPlatform.js";
import { createVsCodeEquationPort, postFetch, type AiKeyHost, type EquationPortDeps, type Pix2texHost } from "../../equations/equationPort.js";
import { createVsCodePaperObjects } from "../../library/index.js";
import { registerNativeHostCommands } from "./nativeHost/index.js";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { FileProjectVersionStore, Logger, createAiVisionTableReader, createProjectContent, formatError, type AiCredentialStore, type AiProvider, type EquationPort, type ICellRunner, type ILogger, type ReaderHostPorts, type RunCellPort } from "@labshelf/core";
import {
  NodeLibraryFileSystem,
  nodePathOps,
  NodePdfOpener,
  exportWithPandoc,
  createNodeSidecarPort,
  createNodePaperNotesPort,
  createNodeReaderThemesPort,
  createNodeEditorPrefsPort,
  createDeviceLocalLayout,
  openAiStorage,
  resolveConflictCopy,
  resolveProjectConflictCopy,
  scanLibraryConflicts,
  createProjectWriteTracking,
  FileLogSink,
  createNodeCellRunner,
  createSharedPythonProvider,
  locateTool,
  resolveSharedToolsDir,
  runCancellable,
  downloadVerified,
  BuildCancelled,
  createManagedPix2texProvider,
  createPix2texRunner,
  createPix2texSource,
  PIX2TEX_PIN,
  pix2texPlatform,
  type PythonProvider,
  type Pix2texProvider,
  type Pix2texRunner,
  readRootPageMap,
  createNodePaperPdf,
} from "@labshelf/core/node";
import {
  createOcrEngine,
  createTextLayerBuilder,
  hostPdfjs,
  findPdfjs,
} from "../../reader/node/index.js";
import type { HostAdapters } from "../hostAdapters.js";

/** Registers the Writing commands and builds that need Node: figures, external project folders, LaTeX and Typst builds, checks, version compare, the project history and the template gallery. */
export const registerNodeWriting: RegisterPlatformWriting = ({ context, host, projects, activeSource, figures, previews, diagnostics, reader, onFindings, includeOnlyTarget }) => {
  const output = vscode.window.createOutputChannel("LabShelf Figures");
  context.subscriptions.push(output);
  registerRegenerateFigure({ context, host, figures, output });
  registerDeckExport(context, { logger: createSessionLogger(host) });
  registerAddExistingFolder({ context, host, projects });
  const tex = createVscodeTex(host);
  const latex = registerLatexBuild({ context, host, tex, projects, previews, diagnostics, ...(includeOnlyTarget && { includeOnlyTarget }) });
  const typst = registerTypstBuild({ context, host, tex, projects, previews, diagnostics, hasPreview: (folder) => previews.hasPreview(folder) });
  const builders = { latex, typst: typst.builds };
  registerCheckCommand({ context, host, projects, builders, pdfjs: hostPdfjs, ...(onFindings && { onFindings }) });
  registerCompareVersionsCommand({ context, host, tex, projects, builders, pdfjs: hostPdfjs, reader });
  registerTemplates({ context, host, tex, projects, builders });
  registerTypstLanguage({ context, logger: createSessionLogger(host), projects });
  const history = registerProjectHistory({ context, host, projects, activeSource });
  return {
    builders, history, stylePreview: (deps) => createStylePreviewHandler({ ...deps, tex, typst: typst.compiler }),
    readPageMap: async (project, root, logger) => await readRootPageMap(project, root, projects.data, logger),
  };
};

/** Builds the extension's logger: the rotating app.log file, with the extension host console as the fallback channel when the sink fails. */
export function createExtensionLogger(appLogPath: string): ILogger {
  return new Logger([new FileLogSink(appLogPath)], {
    onSinkError: (error, entry) => {
      console.error("LabShelf: failed to write a log entry", { module: entry.module, message: entry.message, error });
    },
  });
}

export function createNodeAdapters(context: vscode.ExtensionContext): HostAdapters {
  const fs = new NodeLibraryFileSystem();
  return {
    paths: nodePathOps,
    fs,
    uriOf: (target) => vscode.Uri.file(target),
    createLogger: createExtensionLogger,
    pdfOpener: new NodePdfOpener(hostPdfjs),
    pdfjs: hostPdfjs,
    createPdfTextServices: (logger) => {
      const ocr = createOcrEngine(context, logger);
      return { ocr, textLayerBuilder: createTextLayerBuilder(ocr) };
    },
    createSidecarPort: createNodeSidecarPort,
    createPaperNotesPort: createNodePaperNotesPort,
    createReaderThemesPort: createNodeReaderThemesPort,
    createEditorPrefsPort: createNodeEditorPrefsPort,
    openAiStorage,
    deviceLayout: createDeviceLocalLayout,
    createProjectWriteTracking: (root, logger) => createProjectWriteTracking(fs, root, logger),
    createProjectData: (logger, deviceDirs, projectFs) => createProjectContent({ fs: projectFs, path: nodePathOps, logger, deviceDirs }),
    scanLibraryConflicts: (root, logger) =>
      scanLibraryConflicts(root, new FileProjectVersionStore(fs, nodePathOps, createDeviceLocalLayout(root).mergeBasesDir), logger,
        (file) => { void vscode.window.showInformationMessage(`Combined changes from another device in ${path.basename(file)}.`); }),
    resolveConflictCopy: (copy, resolution, logger, root) => {
      if (resolution === "mergeAutomatically" || resolution === "notAVersion") {
        const store = new FileProjectVersionStore(fs, nodePathOps, createDeviceLocalLayout(root).mergeBasesDir);
        return resolveProjectConflictCopy(copy, resolution, { root, store, logger });
      }
      return resolveConflictCopy(copy, resolution, logger, createProjectWriteTracking(fs, () => root, logger));
    },
    convertDocument: exportWithPandoc,
    sharedLibraryConfig: nodeSharedLibraryConfig,
    reader: { locatePdfjs: findPdfjs, isMac: process.platform === "darwin" },
  };
}

export function createDesktopPlatform(context: vscode.ExtensionContext): ExtensionPlatform {
  const adapters = createNodeAdapters(context);
  let pix2tex: Pix2texHost | undefined;
  const ai = createAiKeyHost(context);
  return {
    adapters,
    registerWriting: registerNodeWriting,
    chooseLibraryRoot: () => pickLibraryRoot(adapters),
    afterSavedLibraryOpened: offerLibraryMove,
    createCellHosts,
    // One pix2tex runner for the extension, built on the first call (it keeps that call's logger): its worker process is shared by every reader and stops with the extension.
    createEquationPort: (deps: EquationPortDeps): EquationPort => createVsCodeEquationPort({ ...deps, pix2tex: (pix2tex ??= createPix2texHost(context, deps.logger)), ai }),
    // The crops run pdf.js on the native canvas in this process; tables read from an image use the same AI keys as equations.
    createPaperObjects: (deps) => createVsCodePaperObjects({
      ...deps, pdf: createNodePaperPdf(hostPdfjs), tableVision: (logger) => createAiVisionTableReader({ credentials: ai.credentials, fetch: postFetch, logger }),
    }),
    createDictionaries: createNodeDictionaryStore,
    registerPlatformCommands: (extensionContext, controller, projects, spaces) => {
      extensionContext.subscriptions.push(vscode.commands.registerCommand("labshelf.moveLibrary", () => runMoveLibraryCommand(controller)));
      extensionContext.subscriptions.push(vscode.commands.registerCommand("labshelf.setAiApiKey", () => ai.addKey()));
      registerNativeHostCommands(extensionContext, adapters);
      const collab = registerCollab(extensionContext, controller, projects, spaces);
      const sharing = createVscodeShareHost(controller, collab, collab.logger);
      registerShareLinks(extensionContext, controller, sharing);
      extensionContext.subscriptions.push(sharingWebviews.serve((webview) => serveShareOn(webview, sharing, collab.logger)));
    },
  };
}

const MODULE = "qmd/runCell";
const CELL_TIMEOUT_MS = 60_000;
const PREVIEW_TIMEOUT_MS = 20_000;

/** The shared Python and the cell runner built once, as the ports the note hosts run cells and install Python through. */
function createCellHosts(context: vscode.ExtensionContext, logger: ILogger): CellHosts {
  const python = createSharedPythonProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  // The bundle copies the driver beside extension.js.
  const out = path.join(context.extensionPath, "out");
  const drivers = { python: path.join(out, "cellDriver.py"), mathematica: path.join(out, "cellDriver.wl"), r: path.join(out, "cellDriver.R") };
  const runner = createNodeCellRunner({ python, drivers, logger, locate: locateCellTool });
  // Deactivation stops every cell process the runner started.
  context.subscriptions.push({ dispose: () => runner.dispose() });
  return {
    runCell: createRunCellPort(runner),
    restartCell: (noteKey, language) => runner.restart(noteKey, language),
    installPython: createInstallPython(python, logger),
  };
}

/** Finds python, wolframscript or Rscript; the path setting is read at each launch, so a change applies to the next process, and an empty one searches. */
function locateCellTool(language: "python" | "mathematica" | "r"): Promise<string | undefined> {
  const [tool, setting] = language === "python" ? ["python", "pythonPath"] as const
    : language === "mathematica" ? ["wolframscript", "wolframscriptPath"] as const : ["Rscript", "rscriptPath"] as const;
  const override = vscode.workspace.getConfiguration("labshelf.cells").get<string>(setting)?.trim();
  return locateTool(tool, override ? { override } : {});
}

/**
 * @returns the port the core hosts run cells through: the runner in the temp folder, with the default timeout, or a shorter one for a preview.
 * Its `runMath` evaluates prose math in the same runner, in the session of the request's note key.
 */
function createRunCellPort(runner: ICellRunner): RunCellPort & { runMath?: NonNullable<ReaderHostPorts["runMath"]> } {
  const runCell: RunCellPort = (request, signal) => runner.run(request, { cwd: os.tmpdir(), signal, timeoutMs: request.preview ? PREVIEW_TIMEOUT_MS : CELL_TIMEOUT_MS });
  const runMath = runner.runMath;
  if (!runMath) { return runCell; }
  return Object.assign(runCell, { runMath: (request: Parameters<typeof runMath>[0], signal?: AbortSignal) => runMath.call(runner, request, signal) });
}

/** @returns an installer of the shared Python that shows its progress; a second call while one runs does nothing. Nothing re-runs after it. */
function createInstallPython(python: PythonProvider, logger: ILogger): () => void {
  let installing = false;
  return () => {
    if (installing) { return; }
    installing = true;
    void installWithProgress(python, logger).finally(() => { installing = false; });
  };
}

async function installWithProgress(python: PythonProvider, logger: ILogger): Promise<void> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Installing Python for LabShelf cells" }, async (progress) => {
      let reported = 0;
      await python.install((message, fraction) => {
        const done = Math.round((fraction ?? reported / 100) * 100);
        progress.report({ message, increment: Math.max(0, done - reported) });
        reported = Math.max(reported, done);
      });
    });
    void vscode.window.showInformationMessage("Python is installed. Press Run again on the cell.");
  } catch (error) {
    await logger.error(MODULE, error, { step: "install python" });
    void vscode.window.showErrorMessage(`Python could not be installed — ${formatError(error)}`);
  }
}

const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai"];
const AI_PROVIDER_NAMES: Readonly<Record<AiProvider, string>> = { anthropic: "Claude (Anthropic)", openai: "OpenAI" };
const aiSecretName = (provider: AiProvider): string => `labshelf.ai.${provider}Key`;

/** The AI keys in VS Code's SecretStorage, outside the synced library; `hasKey` answers from memory, refreshed at start and whenever a secret changes. */
function createAiKeyHost(context: vscode.ExtensionContext): AiKeyHost {
  const secrets = context.secrets;
  const credentials: AiCredentialStore = {
    get: async (provider) => (await secrets.get(aiSecretName(provider))) || undefined,
    set: async (provider, key) => secrets.store(aiSecretName(provider), key),
    delete: async (provider) => secrets.delete(aiSecretName(provider)),
  };
  let stored = false;
  const refresh = async (): Promise<void> => {
    stored = (await Promise.all(AI_PROVIDERS.map((provider) => credentials.get(provider)))).some((key) => key !== undefined);
  };
  void refresh();
  context.subscriptions.push(secrets.onDidChange((event) => { if (AI_PROVIDERS.some((provider) => event.key === aiSecretName(provider))) { void refresh(); } }));
  return {
    credentials,
    hasKey: () => stored,
    addKey: async () => {
      const pick = await vscode.window.showQuickPick(AI_PROVIDERS.map((provider) => ({ label: AI_PROVIDER_NAMES[provider], provider })), { title: "Set AI API key", placeHolder: "Which provider is the key for?" });
      if (!pick) { return false; }
      const key = await vscode.window.showInputBox({
        title: `${AI_PROVIDER_NAMES[pick.provider]} API key`,
        prompt: "The key stays in VS Code's secret storage, never in your library. When a box is read, the equation crop is sent to this provider.",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : "Paste the API key."),
      });
      const trimmed = key?.trim();
      if (!trimmed) { return false; }
      await credentials.set(pick.provider, trimmed);
      await refresh();
      return true;
    },
  };
}

const PIX2TEX_MODULE = "equations/pix2tex";
const CAN_IMPORT_TIMEOUT_MS = 60_000;

/** The pix2tex source over the setting, the managed install and a system Python, with the offer and the install of the managed one; the worker is disposed with the extension. */
function createPix2texHost(context: vscode.ExtensionContext, logger: ILogger): Pix2texHost {
  const python = createSharedPythonProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  const managed = createManagedPix2texProvider({
    root: path.join(resolveSharedToolsDir(process.env, process.platform, os.homedir()), "pix2tex"),
    platform: process.platform, arch: process.arch, python, run: runCancellable, logger,
    download: (url, sha256, signal) => downloadVerified(url, sha256, fetch, signal),
  });
  const runner = createPix2texRunner({
    // The setting is read at each lookup, so a change applies to the next read.
    settingPython: () => vscode.workspace.getConfiguration("labshelf.equations").get<string>("pix2texPython")?.trim() || undefined,
    managed,
    locatePython: () => locateTool("python"),
    canImport: async (interpreter) => (await runCancellable(interpreter, ["-c", "import pix2tex.cli"], os.tmpdir(), new AbortController().signal, { timeoutMs: CAN_IMPORT_TIMEOUT_MS, logger })).code === 0,
    spawn: (command, args, env) => spawn(command, args, { env, stdio: "pipe", windowsHide: true }),
    logger,
  });
  context.subscriptions.push({ dispose: () => runner.dispose() });
  return {
    source: createPix2texSource(runner),
    offer: () => offerPix2tex(managed, runner),
    install: createInstallPix2tex(managed, logger),
  };
}

/** @returns "install" only when the managed install is missing and no runner finds a Python with pix2tex; "none" where there is no managed install for this platform. */
async function offerPix2tex(managed: Pix2texProvider, runner: Pix2texRunner): Promise<"install" | "none"> {
  return (await managed.status()) === "missing" && (await runner.find()) === undefined ? "install" : "none";
}

/** @returns the installer of the managed pix2tex: a cancellable progress notification titled with the download size; a second call while one runs joins it instead of starting another. */
function createInstallPix2tex(managed: Pix2texProvider, logger: ILogger): NonNullable<EquationPort["installPix2tex"]> {
  let running: Promise<boolean> | undefined;
  return (onProgress, signal) => {
    running ??= installPix2texWithProgress(managed, logger, onProgress, signal).finally(() => { running = undefined; });
    return running;
  };
}

async function installPix2texWithProgress(managed: Pix2texProvider, logger: ILogger, onProgress: (message: string, fraction?: number) => void, outer?: AbortSignal): Promise<boolean> {
  const key = pix2texPlatform(process.platform, process.arch);
  const megabytes = key === undefined ? undefined : PIX2TEX_PIN.platforms[key]?.downloadMb;
  const title = megabytes === undefined ? "Installing pix2tex for LabShelf" : `Installing pix2tex for LabShelf (about ${megabytes} MB)`;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (progress, token) => {
      const abort = new AbortController();
      const cancel = token.onCancellationRequested(() => abort.abort());
      const relay = (): void => abort.abort();
      outer?.addEventListener("abort", relay, { once: true });
      if (outer?.aborted) { abort.abort(); }
      let reported = 0;
      try {
        await managed.install((message, fraction) => {
          const done = Math.round((fraction ?? reported / 100) * 100);
          progress.report({ message, increment: Math.max(0, done - reported) });
          reported = Math.max(reported, done);
          onProgress(message, fraction);
        }, abort.signal);
      } finally {
        cancel.dispose();
        outer?.removeEventListener("abort", relay);
      }
    });
    return true;
  } catch (error) {
    if (error instanceof BuildCancelled) { return false; }
    await logger.error(PIX2TEX_MODULE, error, { step: "install pix2tex" });
    void vscode.window.showErrorMessage(`pix2tex could not be installed — ${formatError(error)}`);
    return false;
  }
}
