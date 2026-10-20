// Builds the desktop sharing host the sharing dialogs of every LabShelf webview run on: project sharing, folder links, clipboard and browser.
import * as vscode from "vscode";

import { createSharingHost, type ILogger, type RelayAccountStore, type ShareWorkflowPorts, type SharingHost } from "@labshelf/core";
import { libraryPaths } from "../../ui/list/index.js";
import { OPEN_PROJECT_COMMAND } from "../../writing/session/index.js";
import { withLibraryPaths } from "./libraryPathSharing.js";
import { openServices, vscodeFolderLinks, type SharingController } from "./vscodeFolderLinks.js";

export interface SharingCollab {
  ports: ShareWorkflowPorts;
  relay: RelayAccountStore;
}

export function createVscodeSharingHost(controller: SharingController, collab: SharingCollab, logger: ILogger): SharingHost {
  const host = createSharingHost({
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
