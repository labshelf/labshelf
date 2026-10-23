// Builds the Node implementations of every host port: the one place that instantiates Node adapters.
import * as path from "node:path";
import * as vscode from "vscode";

import { FileProjectVersionStore, createProjectData } from "@labshelf/core";
import {
  NodeLibraryFileSystem, NodePdfOpener, convertWithPandoc, createNodeSidecarPort, deviceLocalLayout, openAiStorage, resolveConflictCopy, resolveProjectConflictCopy,
  scanLibraryConflicts, createProjectSaveTracking,
} from "@labshelf/core/node";
import { createExtensionLogger } from "../../core/node/index.js";
import { createOcrEngine, createTextLayerBuilder, hostPdfjs } from "../../pdf/node/index.js";
import { locatePdfjs } from "../../pdf-viewer/node/index.js";
import { nodeSharedLibraryConfig } from "../../storage/node/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

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
    deviceLayout: deviceLocalLayout,
    createProjectSaveTracking: (root, logger) => createProjectSaveTracking(fs, root, logger),
    createProjectData: (logger, deviceDirs, projectFs) => createProjectData({ fs: projectFs, path, logger, deviceDirs }),
    scanLibraryConflicts: (root, logger) =>
      scanLibraryConflicts(root, new FileProjectVersionStore(fs, path, deviceLocalLayout(root).mergeBasesDir), logger,
        (file) => { void vscode.window.showInformationMessage(`Combined changes from another device in ${path.basename(file)}.`); }),
    resolveConflictCopy: (copy, resolution, logger, root) => {
      if (resolution === "mergeAutomatically" || resolution === "notAVersion") {
        const store = new FileProjectVersionStore(fs, path, deviceLocalLayout(root).mergeBasesDir);
        return resolveProjectConflictCopy(copy, resolution, { root, store, logger });
      }
      return resolveConflictCopy(copy, resolution, logger, createProjectSaveTracking(fs, () => root, logger));
    },
    convertDocument: convertWithPandoc,
    sharedLibraryConfig: nodeSharedLibraryConfig,
    reader: { locatePdfjs, isMac: process.platform === "darwin" },
  };
}
