// Builds the desktop sharing host the sharing dialogs of every LabShelf webview run on: project sharing, folder links, clipboard and browser.
import * as vscode from "vscode";

import {
  createShareHost,
  type ILogger,
  type RelayAccountStore,
  type ShareFlowPorts,
  type ShareHost,
  createWorkerShareReader,
  importShareLink,
  resolveRelayBackend,
  type FolderShareLinkDeps,
} from "@labshelf/core";
import { libraryPaths, type LibraryPaths } from "../../libraryUi/index.js";
import { OPEN_PROJECT_COMMAND } from "../../writing/session/index.js";
import type { LibraryRootController } from "../../activation/index.js";
import type { ActiveServices } from "../../command/index.js";
import { connectedRelay, shareRegistry, type ShareLinkHost } from "./index.js";

type SharingController = Pick<LibraryRootController, "currentRoot" | "currentServices" | "require">;

const NO_LIBRARY = "Open a LabShelf library first.";

/** The open library's services; the dialogs run only beside an open library, so none is a failure. */
function openServices(controller: SharingController): ActiveServices {
  const services = controller.currentServices();
  if (!services) { throw new Error(NO_LIBRARY); }
  return services;
}

// INVARIANT: every member reads the open library at call time, so the host follows a library switch.
function vscodeFolderLinks(controller: SharingController, relay: RelayAccountStore): FolderShareLinkDeps {
  const services = () => openServices(controller);
  const host: ShareLinkHost = { libraryRoot: () => controller.currentRoot()?.fsPath, relay };
  return {
    papers: () => [...services().library.snapshot.papers.values()].map((entry) => entry.record),
    get papersRoot() { return services().mutations.papersRoot; },
    get sep() { return services().mutations.paths.sep; },
    get sources() {
      const { mutations: { fs, paths }, paperDataStore } = services();
      return { fs, paths, annotations: (paperId: string) => paperDataStore.getAnnotations(paperId) };
    },
    get registry() {
      const registry = shareRegistry(host);
      if (!registry) { throw new Error(NO_LIBRARY); }
      return registry;
    },
    relay: {
      require: () => connectedRelay(host, "share links are served by your own relay."),
      connected: () => relay.get(),
    },
    backendFor: resolveRelayBackend,
    readerFor: (relayUrl) => createWorkerShareReader({ relayUrl }),
    importLink: async (options) => {
      const { mutations, paperService } = services();
      return importShareLink({ ...options, ctx: mutations, parentDir: mutations.papersRoot, known: await paperService.listPapers() });
    },
    refresh: async () => { await services().reindexLibrary(); },
    openFolder: async (dir) => {
      await vscode.commands.executeCommand("labshelf.openListTab", { label: services().mutations.paths.basename(dir), dirPath: dir });
    },
  };
}

const OUTSIDE = "This folder is outside the library.";

function diskPath(paths: LibraryPaths, ui: string): string {
  const abs = paths.fromUi(ui);
  // TRAP: fromUi joins whatever it is given, so only a round trip proves the path names a folder under papers/.
  if (paths.toUi(abs) !== ui) { throw new Error(OUTSIDE); }
  return abs;
}

/** `paths` is read per call, since the open library can change under the host. */
export function withLibraryPaths(host: ShareHost, paths: () => LibraryPaths): ShareHost {
  return {
    ...host,
    shareableFolder: async (ui) => {
      const lib = paths();
      const folder = await host.shareableFolder(diskPath(lib, ui));
      return folder && { ...folder, path: lib.toUi(folder.path) ?? ui };
    },
    shareFolder: async (ui, withAnnotations, onProgress) => host.shareFolder(diskPath(paths(), ui), withAnnotations, onProgress),
    openFolder: async (ui) => host.openFolder(diskPath(paths(), ui)),
    importLink: async (text, onProgress) => {
      const result = await host.importLink(text, onProgress);
      if (result.kind !== "imported" || result.folder === undefined) { return result; }
      const folder = paths().toUi(result.folder);
      return folder === null ? { kind: "imported", summary: result.summary } : { ...result, folder };
    },
    sharedLinks: async () => {
      const lib = paths();
      return (await host.sharedLinks()).map((link) => ({ ...link, folder: lib.toUi(link.folder) ?? link.folder }));
    },
  };
}

export interface SharingCollab {
  ports: ShareFlowPorts;
  relay: RelayAccountStore;
}

export function createVscodeSharingHost(controller: SharingController, collab: SharingCollab, logger: ILogger): ShareHost {
  const host = createShareHost({
    place: "this device",
    logger,
    projects: {
      ports: collab.ports,
      idOf: (entry) => entry.folder,
      open: async (entry) => { await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry); },
    },
    links: vscodeFolderLinks(controller, collab.relay),
    clipboard: { write: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)) },
    openLink: async (url) => { await vscode.env.openExternal(vscode.Uri.parse(url)); },
  });
  return withLibraryPaths(host, () => {
    const { mutations } = openServices(controller);
    return libraryPaths(mutations.papersRoot, mutations.paths);
  });
}
