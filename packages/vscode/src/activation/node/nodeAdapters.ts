// Builds the Node implementations of every host port: the one place that instantiates Node adapters.
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";

import { NodeLockStore, NodePdfOpener, createNodeSidecarPort, isProcessAlive, listSyncProjects, openAiStorage } from "@labshelf/core/node";
import { createExtensionLogger } from "../../core/node/index.js";
import { createOcrEngine, createTextLayerBuilder, hostPdfjs } from "../../pdf/node/index.js";
import { locatePdfjs } from "../../pdf-viewer/node/index.js";
import { nodeSharedLibraryConfig } from "../../storage/node/index.js";
import { createVscodeDriveAuth } from "../../sync/node/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

export function createNodeAdapters(context: vscode.ExtensionContext): HostAdapters {
  return {
    paths: path,
    createLogger: createExtensionLogger,
    pdfOpener: new NodePdfOpener(hostPdfjs),
    createPdfTextServices: (logger) => {
      const ocr = createOcrEngine(context, logger);
      return { ocr, textLayerBuilder: createTextLayerBuilder(ocr) };
    },
    createSidecarPort: createNodeSidecarPort,
    openAiStorage,
    sync: {
      host: { name: os.hostname(), pid: process.pid },
      lock: { store: new NodeLockStore(), isProcessAlive },
      createDriveAuth: (logger) => createVscodeDriveAuth(context, logger),
      listProjects: listSyncProjects,
    },
    sharedLibraryConfig: nodeSharedLibraryConfig,
    reader: { locatePdfjs, isMac: process.platform === "darwin" },
  };
}
