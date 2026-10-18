// Builds the web implementations of every host port: the VS Code file system, an output-channel logger, and the Node-only services refused.
import * as vscode from "vscode";

import { createProjectData, posixPathOps, type ILogger, type SidecarPort } from "@labshelf/core";
import { VscodeFileSystem, type UriOfPath } from "../../storage/index.js";
import { globalStateLibraryConfig } from "../../storage/paths/index.js";
import type { HostAdapters, HostDeviceLayout } from "../serviceComposition/index.js";
import { bundledPdfjs } from "./bundledPdfjs.js";

const unavailable = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} is not available in the web build.`));

/** Device folders of one library in the extension's global storage, keyed by the library root. */
function deviceLayout(storage: string, root: string): HostDeviceLayout {
  const library = posixPathOps.join(storage, "libraries", encodeURIComponent(root));
  return {
    projectRegistryPath: posixPathOps.join(library, "projects.json"),
    mergeBasesDir: posixPathOps.join(library, "merge-bases"),
    buildCacheDir: posixPathOps.join(storage, "builds"),
    appLogPath: posixPathOps.join(library, "logs", "app.log"),
    aiDatabasePath: posixPathOps.join(library, "index.sqlite"),
    openAlexCacheDir: posixPathOps.join(library, "openalex"),
  };
}

function sidecarPort(fs: VscodeFileSystem, paperDataPath: (paperId: string) => string): SidecarPort {
  return {
    read: async (paperId) => (await fs.exists(paperDataPath(paperId)) ? await fs.readText(paperDataPath(paperId)) : null),
    write: (paperId, text) => fs.writeText(paperDataPath(paperId), text),
  };
}

/** @param logger the one logger of the web build: its output channel stands in for every library's app.log */
export function createWebAdapters(context: vscode.ExtensionContext, logger: ILogger): HostAdapters {
  const storage = context.globalStorageUri;
  // PLATFORM: the web host serves the extension's global storage under its own scheme, while library paths are file: paths.
  const uriOf: UriOfPath = (target) =>
    (target === storage.path || target.startsWith(`${storage.path}/`) ? storage.with({ path: target }) : vscode.Uri.file(target));
  const fs = new VscodeFileSystem(undefined, posixPathOps, uriOf);
  return {
    paths: posixPathOps,
    fs,
    uriOf,
    createLogger: () => logger,
    pdfOpener: { open: unavailable("Reading PDFs") },
    pdfjs: { load: unavailable("pdf.js"), getDocument: unavailable("pdf.js") },
    createPdfTextServices: () => ({ ocr: undefined, textLayerBuilder: { build: unavailable("Making PDFs searchable"), detect: unavailable("Reading PDF text") } }),
    createSidecarPort: (layout) => sidecarPort(fs, (paperId) => layout.paperDataPath(paperId)),
    openAiStorage: unavailable("The AI index"),
    deviceLayout: (root) => deviceLayout(storage.path, root),
    createProjectData: (projectLogger, deviceDirs) => createProjectData({ fs, path: posixPathOps, logger: projectLogger, deviceDirs }),
    // PLATFORM: the conflict scan reads folders through Node, so the web build lists no conflict copies.
    scanLibraryConflicts: async () => [],
    resolveConflictCopy: unavailable("Resolving conflict copies"),
    sharedLibraryConfig: globalStateLibraryConfig(context.globalState),
    reader: { locatePdfjs: bundledPdfjs(context.extensionUri), isMac: /Mac/i.test(globalThis.navigator?.userAgent ?? "") },
  };
}
