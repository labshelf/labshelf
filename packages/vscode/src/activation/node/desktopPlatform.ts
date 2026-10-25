// Builds the desktop platform: Node adapters, the Node Writing registrations, the library flows over the user's disk and the sharing host.
import * as vscode from "vscode";

import { registerCollab } from "../../collab/node/index.js";
import { pickLibraryRoot, offerLibraryMove, runMoveLibraryCommand } from "../../library/node/index.js";
import { registerShareLinks } from "../../share/node/index.js";
import { sharingWebviews } from "../../share/index.js";
import { createVscodeShareHost, serveShareOn } from "../../share/node/index.js";
import { registerNodeWriting } from "../../writing/node/index.js";
import type { ExtensionPlatform } from "../extensionPlatform.js";
import { registerNativeHostCommands } from "./nativeHost/index.js";
import * as path from "node:path";
import { FileProjectVersionStore, createProjectContent } from "@labshelf/core";
import {
  NodeLibraryFileSystem,
  NodePdfOpener,
  exportWithPandoc,
  createNodeSidecarPort,
  createDeviceLocalLayout,
  openAiStorage,
  resolveConflictCopy,
  resolveProjectConflictCopy,
  scanLibraryConflicts,
  createProjectSaveTracking,
} from "@labshelf/core/node";
import { createExtensionLogger } from "../../logging/node/index.js";
import {
  createOcrEngine,
  createTextLayerBuilder,
  hostPdfjs,
  findPdfjs,
} from "../../reader/node/index.js";
import { nodeSharedLibraryConfig } from "../../storage/node/index.js";
import type { HostAdapters } from "../hostAdapters.js";

export function createNodeAdapters(context: vscode.ExtensionContext): HostAdapters {
  const fs = new NodeLibraryFileSystem();
  return {
    paths: path,
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
    openAiStorage,
    deviceLayout: createDeviceLocalLayout,
    createProjectSaveTracking: (root, logger) => createProjectSaveTracking(fs, root, logger),
    createProjectData: (logger, deviceDirs, projectFs) => createProjectContent({ fs: projectFs, path, logger, deviceDirs }),
    scanLibraryConflicts: (root, logger) =>
      scanLibraryConflicts(root, new FileProjectVersionStore(fs, path, createDeviceLocalLayout(root).mergeBasesDir), logger,
        (file) => { void vscode.window.showInformationMessage(`Combined changes from another device in ${path.basename(file)}.`); }),
    resolveConflictCopy: (copy, resolution, logger, root) => {
      if (resolution === "mergeAutomatically" || resolution === "notAVersion") {
        const store = new FileProjectVersionStore(fs, path, createDeviceLocalLayout(root).mergeBasesDir);
        return resolveProjectConflictCopy(copy, resolution, { root, store, logger });
      }
      return resolveConflictCopy(copy, resolution, logger, createProjectSaveTracking(fs, () => root, logger));
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
