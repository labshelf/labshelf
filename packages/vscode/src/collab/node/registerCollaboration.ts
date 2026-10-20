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
  JOIN_COMMAND, joinProject, LEAVE_COMMAND, leaveProject, OFFER_RELAY_COMMAND, offerRelay, registerShareStatusBar, SHARE_COMMAND, shareProject,
  WITHDRAW_RELAY_COMMAND, withdrawRelay, type ProjectTarget,
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

export function registerCollaboration(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): void {
  const host = createHost(context, controller, projects);
  registerShareStatusBar(context, host);
  registerRelay(context, {
    accounts: host.relay, logger: host.logger,
    offerToShares: async () => { (await offerOwnRelayToShares(host.ports)).forEach(showRefusedOffer); },
    withdrawFromShares: (relayUrl) => withdrawOwnRelayFromShares(host.ports, relayUrl),
  });
  registerComments(context, { projects, shares: host.shares, userName: userName(), logger: host.logger });
  context.subscriptions.push(
    vscode.commands.registerCommand(SHARE_COMMAND, (target?: unknown) => shareProject(host, projectTarget(target))),
    vscode.commands.registerCommand(JOIN_COMMAND, (invite?: unknown) => joinProject(host, typeof invite === "string" ? invite : undefined)),
    vscode.commands.registerCommand(LEAVE_COMMAND, (target?: unknown) => leaveProject(host, projectTarget(target))),
    vscode.commands.registerCommand(OFFER_RELAY_COMMAND, () => offerRelay(host)),
    vscode.commands.registerCommand(WITHDRAW_RELAY_COMMAND, () => withdrawRelay(host)),
    resumeShares(host),
  );
}

/** A folder path or a project entry from a view; anything else, such as a URI from a menu, means no target. */
function projectTarget(target: unknown): ProjectTarget {
  if (typeof target === "string") { return target; }
  return typeof target === "object" && target !== null && "folder" in target && "kind" in target ? (target as ProjectTarget) : undefined;
}
