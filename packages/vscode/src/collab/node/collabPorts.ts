// Adapts this window's keys, shares, projects, relay account and state dir to the ports of the core share workflows.
import * as vscode from "vscode";

import type { ILogger, RelayAccountStore, ShareWorkflowPorts } from "@labshelf/core";
import { nodeProjectReadContext } from "@labshelf/core/node";
import { CONNECT_RELAY_COMMAND } from "../../relay/index.js";
import type { WritingProjects } from "../../writing/index.js";
import type { SharedEditors } from "./editors/index.js";
import { type ActiveShares, connectDesktopShare, deleteShareState, ShareKeys } from "./session/index.js";
import { userName } from "./userName.js";

export interface CollabPortsDeps {
  secrets: vscode.SecretStorage;
  libraryRoot(): string | undefined;
  logger: ILogger;
  projects: WritingProjects;
  shares: ActiveShares;
  editors: SharedEditors;
  relay: RelayAccountStore;
}

function openRoot(libraryRoot: () => string | undefined): string {
  const root = libraryRoot();
  if (!root) { throw new Error("no library is open"); }
  return root;
}

export function createCollabPorts(deps: CollabPortsDeps): ShareWorkflowPorts {
  const { logger, editors } = deps;
  return {
    keys: new ShareKeys(deps.secrets, logger),
    shares: deps.shares,
    projects: deps.projects,
    files: nodeProjectReadContext(logger),
    relay: deps.relay,
    requireRelay: async () => (await vscode.commands.executeCommand<boolean>(CONNECT_RELAY_COMMAND)) === true,
    connect: ({ shareId, shareKey, relays }, start) => {
      const isEditorOwned = (folder: string, file: string) => editors.isOwned(folder, file);
      return connectDesktopShare({ libraryRoot: openRoot(deps.libraryRoot), shareId, shareKey, relays, name: userName(), logger, isEditorOwned }, start);
    },
    deleteState: (shareId) => deleteShareState(openRoot(deps.libraryRoot), shareId),
    userName,
    logger,
  };
}
