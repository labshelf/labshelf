// Builds the Node implementations of every host port: the one place that instantiates Node adapters.
import * as path from "node:path";
import * as vscode from "vscode";

import { FileMergeBaseStore, createProjectData } from "@labshelf/core";
import {
  NodeLibraryFileSystem, NodePdfOpener, convertWithPandoc, createNodeSidecarPort, deviceLocalLayout, openAiStorage, resolveConflictCopy,
  scanLibraryConflicts,
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
    createProjectData: (logger, deviceDirs) => createProjectData({ fs, path, logger, deviceDirs }),
    scanLibraryConflicts: (root, logger) =>
      scanLibraryConflicts(root, new FileMergeBaseStore(fs, path, deviceLocalLayout(root).mergeBasesDir), logger),
    resolveConflictCopy,
    convertDocument: convertWithPandoc,
    sharedLibraryConfig: nodeSharedLibraryConfig,
    reader: { locatePdfjs, isMac: process.platform === "darwin" },
  };
}
