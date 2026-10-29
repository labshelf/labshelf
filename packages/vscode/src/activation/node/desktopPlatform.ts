// Builds the desktop platform: Node adapters, the Node Writing registrations, the library flows over the user's disk and the sharing host.
import * as vscode from "vscode";

import { registerCollab } from "../../collab/node/index.js";
import { nodeSharedLibraryConfig, pickLibraryRoot, offerLibraryMove, runMoveLibraryCommand } from "../../library/node/index.js";
import { registerShareLinks } from "../../share/node/index.js";
import { sharingWebviews } from "../../share/index.js";
import { createVscodeShareHost, serveShareOn } from "../../share/node/index.js";
import { registerNodeWriting } from "../../writing/node/index.js";
import type { ExtensionPlatform } from "../extensionPlatform.js";
import { registerNativeHostCommands } from "./nativeHost/index.js";
import * as path from "node:path";
import { FileProjectVersionStore, Logger, createProjectContent, type ILogger } from "@labshelf/core";
import {
  NodeLibraryFileSystem,
  nodePathOps,
  NodePdfOpener,
  exportWithPandoc,
  createNodeSidecarPort,
  createNodePaperNotesPort,
  createDeviceLocalLayout,
  openAiStorage,
  resolveConflictCopy,
  resolveProjectConflictCopy,
  scanLibraryConflicts,
  createProjectWriteTracking,
  FileLogSink,
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
