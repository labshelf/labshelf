// Builds the desktop platform: Node adapters, the Node Writing registrations, the library flows over the user's disk, the sharing host and the cell hosts.
import * as vscode from "vscode";

import { registerCollab } from "../../collab/node/index.js";
import { nodeSharedLibraryConfig, pickLibraryRoot, offerLibraryMove, runMoveLibraryCommand } from "../../library/node/index.js";
import { registerShareLinks } from "../../share/node/index.js";
import { sharingWebviews } from "../../share/index.js";
import { createVscodeShareHost, serveShareOn } from "../../share/node/index.js";
import { registerNodeWriting } from "../../writing/node/index.js";
import type { CellHosts, ExtensionPlatform } from "../extensionPlatform.js";
import { registerNativeHostCommands } from "./nativeHost/index.js";
import * as os from "node:os";
import * as path from "node:path";
import { FileProjectVersionStore, Logger, createProjectContent, formatError, type ICellRunner, type ILogger, type RunCellPort } from "@labshelf/core";
import {
  NodeLibraryFileSystem,
  nodePathOps,
  NodePdfOpener,
  exportWithPandoc,
  createNodeSidecarPort,
  createNodePaperNotesPort,
  createNodeReaderThemesPort,
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
  type PythonProvider,
} from "@labshelf/core/node";
import {
  createOcrEngine,
  createTextLayerBuilder,
  hostPdfjs,
  findPdfjs,
} from "../../reader/node/index.js";
import type { HostAdapters } from "../hostAdapters.js";

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
  return {
    adapters,
    registerWriting: registerNodeWriting,
    chooseLibraryRoot: () => pickLibraryRoot(adapters),
    afterSavedLibraryOpened: offerLibraryMove,
    createCellHosts,
    registerPlatformCommands: (extensionContext, controller, projects) => {
      extensionContext.subscriptions.push(vscode.commands.registerCommand("labshelf.moveLibrary", () => runMoveLibraryCommand(controller)));
      registerNativeHostCommands(extensionContext, adapters);
      const collab = registerCollab(extensionContext, controller, projects);
      registerShareLinks(extensionContext, controller);
      const sharing = createVscodeShareHost(controller, collab, collab.logger);
      extensionContext.subscriptions.push(sharingWebviews.serve((webview) => serveShareOn(webview, sharing, collab.logger)));
    },
  };
}

const MODULE = "qmd/runCell";
const CELL_TIMEOUT_MS = 60_000;

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

/** Finds wolframscript or Rscript; the path setting is read at each launch, so a change applies to the next process, and an empty one searches. */
function locateCellTool(language: "mathematica" | "r"): Promise<string | undefined> {
  const [tool, setting] = language === "mathematica" ? ["wolframscript", "wolframscriptPath"] as const : ["Rscript", "rscriptPath"] as const;
  const override = vscode.workspace.getConfiguration("labshelf.cells").get<string>(setting)?.trim();
  return locateTool(tool, override ? { override } : {});
}

/** @returns the port the core hosts run cells through: the runner with the default timeout, in the temp folder. */
function createRunCellPort(runner: ICellRunner): RunCellPort {
  return (code, signal) => runner.run(code, { cwd: os.tmpdir(), signal, timeoutMs: CELL_TIMEOUT_MS });
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
