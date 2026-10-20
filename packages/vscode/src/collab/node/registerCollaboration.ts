// Wires project collaboration on the desktop: the share, join and leave commands, the owner's relay, editor binding, presence, comments and status bar.
import * as vscode from "vscode";

import { offerOwnRelayToShares, withdrawOwnRelayFromShares } from "@labshelf/core";
import type { LibraryRootController } from "../../activation/libraryLifecycle/index.js";
import { openLibraryLogger } from "../../activation/registration/index.js";
import { openRelayAccounts, registerRelay } from "../../relay/index.js";
import type { WritingProjects } from "../../writing/index.js";
import { showRefusedOffer, type CollabHost } from "./collabHost.js";
import { createCollabPorts } from "./collabPorts.js";
import {
  OFFER_RELAY_COMMAND, offerRelay, registerProjectDialogCommands, registerShareStatusBar, WITHDRAW_RELAY_COMMAND, withdrawRelay,
} from "./commands/index.js";
import { SharedEditors, SharedPresence } from "./editors/index.js";
import { registerComments } from "./registerComments.js";
import { resumeShares } from "./resumeShares.js";
import { ActiveShares } from "./session/index.js";
import { userName } from "./userName.js";

type Controller = Pick<LibraryRootController, "currentRoot" | "currentServices" | "require">;

function createHost(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): CollabHost {
  const logger = openLibraryLogger(controller);
  const libraryRoot = () => controller.currentRoot()?.fsPath;
  // The editors and the presence read the shares through these closures, which run only after `shares` exists.
  const editors = new SharedEditors(() => shares.list(), logger);
  const presence = new SharedPresence(editors, () => shares.list(), userName());
  const shares = new ActiveShares((share) => vscode.Disposable.from(editors.attach(share), presence.watch(share)));
  context.subscriptions.push(editors, presence, shares);
  const relay = openRelayAccounts(context.secrets, logger);
  return {
    libraryRoot,
    requireLibrary: async () => { await controller.require(); return libraryRoot(); },
    logger, projects, shares, editors, relay,
    ports: createCollabPorts({ secrets: context.secrets, libraryRoot, logger, projects, shares, editors, relay }),
  };
}

/** Returns the collaboration host, which the desktop sharing host shares projects over. */
export function registerCollaboration(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): CollabHost {
  const host = createHost(context, controller, projects);
  registerShareStatusBar(context, host);
  registerRelay(context, {
    accounts: host.relay, logger: host.logger,
    offerToShares: async () => { (await offerOwnRelayToShares(host.ports)).forEach(showRefusedOffer); },
    withdrawFromShares: (relayUrl) => withdrawOwnRelayFromShares(host.ports, relayUrl),
  });
  registerComments(context, { projects, shares: host.shares, userName: userName(), logger: host.logger });
  context.subscriptions.push(
    registerProjectDialogCommands(host.requireLibrary),
    vscode.commands.registerCommand(OFFER_RELAY_COMMAND, () => offerRelay(host)),
    vscode.commands.registerCommand(WITHDRAW_RELAY_COMMAND, () => withdrawRelay(host)),
    resumeShares(host),
  );
  return host;
}
