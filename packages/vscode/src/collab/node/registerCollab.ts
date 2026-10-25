// Wires project collaboration on the desktop: the share, join and leave commands, the owner's relay, editor binding, presence, comments and status bar.
import * as vscode from "vscode";

import {
  offerOwnRelayToShares,
  createStoreFailureNotices,
  removeOwnRelayOfferFromShares,
  type ILogger,
  type RelayAccountStore,
  type ShareFlowPorts,
  createShareResumer,
} from "@labshelf/core";
import type { LibraryRootController } from "../../activation/index.js";
import { openLibraryLogger } from "../../activation/index.js";
import { openRelayAccounts, registerRelay, CONNECT_RELAY_COMMAND } from "../../relay/index.js";
import type { WritingProjects } from "../../writing/index.js";
import {
  showRefusedOffer,
  type CollabHost,
  reportFailure,
  errorText,
  projectName,
} from "./collabHost.js";
import {
  OFFER_RELAY_COMMAND,
  offerRelay,
  registerProjectDialogCommands,
  registerShareStatusBar,
  WITHDRAW_RELAY_COMMAND,
  withdrawRelay,
  JOIN_COMMAND,
} from "./commands/index.js";
import { SharedEditors, SharedPresence } from "./editors/index.js";
import { ActiveShares, connectDesktopShare, deleteShareState, ShareKeys } from "./session/index.js";
import { createNodeProjectReadCompositionRoot } from "@labshelf/core/node";
import {
  ADD_SOURCE_COMMENT_COMMAND,
  CommentsController,
  type CommentsDeps,
  type SourceComment,
} from "../comments/index.js";
import * as os from "node:os";

function userName(): string {
  try {
    return os.userInfo().username;
  } catch {
    // PLATFORM: userInfo throws for a user without a passwd entry, as in some containers.
    return "LabShelf user";
  }
}

/** A reload also follows a change of library. */
function resumeShares(host: CollabHost): vscode.Disposable {
  const resumer = createShareResumer(host.ports, {
    missingKey: (project) => {
      const join = "Join";
      void vscode.window.showInformationMessage(`Shared project "${projectName(project)}": paste the invite to reconnect.`, join).then((choice) => {
        if (choice === join) { void vscode.commands.executeCommand(JOIN_COMMAND); }
      });
    },
    failed: (project, error) => {
      void vscode.window.showErrorMessage(`LabShelf could not reconnect the shared project "${projectName(project)}": ${errorText(error)}`);
    },
  });
  const subscription = host.projects.onDidChange(() => void resumer.sync());
  void resumer.sync();
  return subscription;
}

const REPLY_COMMAND = "labshelf.comment.reply";
const RESOLVE_COMMAND = "labshelf.comment.resolve";
const REOPEN_COMMAND = "labshelf.comment.reopen";

function guarded<T>(deps: CommentsDeps, action: string, run: (arg: T) => Promise<void>): (arg: T) => Promise<void> {
  return async (arg) => {
    try {
      await run(arg);
    } catch (error) {
      reportFailure(deps.logger, action, error);
    }
  };
}

function registerComments(context: vscode.ExtensionContext, deps: CommentsDeps): void {
  const comments = new CommentsController(deps);
  context.subscriptions.push(
    comments,
    vscode.commands.registerCommand(REPLY_COMMAND, guarded(deps, "add the comment", (reply: vscode.CommentReply) => comments.reply(reply))),
    vscode.commands.registerCommand(RESOLVE_COMMAND, guarded(deps, "resolve the thread", (thread: vscode.CommentThread) => comments.setResolved(thread, true))),
    vscode.commands.registerCommand(REOPEN_COMMAND, guarded(deps, "reopen the thread", (thread: vscode.CommentThread) => comments.setResolved(thread, false))),
    // Failures go back to the caller, which reports them with the PDF point they came from.
    vscode.commands.registerCommand(ADD_SOURCE_COMMENT_COMMAND, (request: SourceComment) => comments.addSourceComment(request)),
  );
}

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

export function createCollabPorts(deps: CollabPortsDeps): ShareFlowPorts {
  const { logger, editors } = deps;
  return {
    keys: new ShareKeys(deps.secrets, logger),
    shares: deps.shares,
    projects: deps.projects,
    files: createNodeProjectReadCompositionRoot(logger),
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

type Controller = Pick<LibraryRootController, "currentRoot" | "currentServices" | "require">;

function createHost(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): CollabHost {
  const logger = openLibraryLogger(controller);
  const libraryRoot = () => controller.currentRoot()?.fsPath;
  // The editors and the presence read the shares through these closures, which run only after `shares` exists.
  const editors: SharedEditors = new SharedEditors(() => shares.list(), logger);
  const presence: SharedPresence = new SharedPresence(editors, () => shares.list(), userName());
  const shares: ActiveShares = new ActiveShares((share) => vscode.Disposable.from(editors.attach(share), presence.watch(share)));
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
  const noticeFailures = createStoreFailureNotices(host.ports, "window", (message) => { void vscode.window.showErrorMessage(message); });
  registerRelay(context, {
    accounts: host.relay, logger: host.logger,
    offerToShares: async () => { (await offerOwnRelayToShares(host.ports)).forEach(showRefusedOffer); },
    withdrawFromShares: (relayUrl) => removeOwnRelayOfferFromShares(host.ports, relayUrl),
  });
  registerComments(context, { projects, shares: host.shares, userName: userName(), logger: host.logger });
  context.subscriptions.push(
    registerProjectDialogCommands(host.requireLibrary),
    vscode.commands.registerCommand(OFFER_RELAY_COMMAND, () => offerRelay(host)),
    vscode.commands.registerCommand(WITHDRAW_RELAY_COMMAND, () => withdrawRelay(host)),
    resumeShares(host),
    host.shares.onDidChange(noticeFailures),
  );
  return host;
}
