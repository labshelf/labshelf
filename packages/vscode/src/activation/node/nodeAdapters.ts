// Builds the Node implementations of every host port: the one place that instantiates Node adapters.
import * as path from "node:path";
import type * as vscode from "vscode";

import { FileMergeBaseStore, createProjectData } from "@labshelf/core";
import {
  NodeLibraryFileSystem, NodePdfOpener, createNodeSidecarPort, deviceLocalLayout, openAiStorage, scanLibraryConflicts,
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
    createLogger: createExtensionLogger,
    pdfOpener: new NodePdfOpener(hostPdfjs),
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
    sharedLibraryConfig: nodeSharedLibraryConfig,
    reader: { locatePdfjs, isMac: process.platform === "darwin" },
  };
}
