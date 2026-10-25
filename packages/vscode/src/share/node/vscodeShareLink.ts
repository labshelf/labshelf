// Runs the folder-link half of the sharing host over the library open in this window, its device share list and the owner's relay.
import * as vscode from "vscode";

import { createWorkerShareReader, importShareLink, relayBackendFor, type FolderLinkDeps, type RelayAccountStore } from "@labshelf/core";
import type { LibraryRootController } from "../../activation/index.js";
import type { ActiveServices } from "../../command/index.js";
import { connectedRelay, shareRegistry, type ShareLinkHost } from "./index.js";

export type SharingController = Pick<LibraryRootController, "currentRoot" | "currentServices" | "require">;

const NO_LIBRARY = "Open a LabShelf library first.";

/** The open library's services; the dialogs run only beside an open library, so none is a failure. */
export function openServices(controller: SharingController): ActiveServices {
  const services = controller.currentServices();
  if (!services) { throw new Error(NO_LIBRARY); }
  return services;
}

// INVARIANT: every member reads the open library at call time, so the host follows a library switch.
export function vscodeFolderLinks(controller: SharingController, relay: RelayAccountStore): FolderLinkDeps {
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
    backendFor: relayBackendFor,
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
