// Wires project collaboration on the desktop: the share, join and leave commands, the owner's relay, editor binding, presence, comments and status bar,
// and the stores behind invitations by email (the library's identity in SecretStorage, its contacts and the switch in global state).
import * as os from "node:os";
import * as vscode from "vscode";

import {
  createAccessTokenReader,
  createInvitations,
  formatError,
  isContact,
  isEmailPin,
  isIdentityJwk,
  offerOwnRelayToShares,
  createStoreFailureNotices,
  removeOwnRelayOfferFromShares,
  systemRelayClock,
  type ILogger,
  type InvitationPorts,
  type Invitations,
  type InvitationView,
  type RelayAccountStore,
  type ShareConnection,
  type ShareFlowPorts,
  createShareResumer,
} from "@labshelf/core";
import { createDeviceIdentity, createDeviceLocalLayout, createNodeProjectReadCompositionRoot } from "@labshelf/core/node";
import type { LibraryRootController } from "../../activation/index.js";
import { openLibraryLogger } from "../../activation/index.js";
import { openRelayAccounts, registerRelay, CONNECT_RELAY_COMMAND } from "../../relay/node/index.js";
import type { WritingProjects } from "../../writing/index.js";
import { ADD_SOURCE_COMMENT_COMMAND, CommentsController, provideSourceFileComments, type CommentsDeps, type SourceComment } from "../comments.js";
import { provideSourceFileSuggestions, SuggestionsController, type SuggestionsDeps } from "../suggestions.js";
import {
  showRefusedOffer,
  type CollabHost,
  reportFailure,
  formatProjectName,
  OFFER_RELAY_COMMAND,
  offerRelay,
  registerProjectDialogCommands,
  registerShareStatusBar,
  WITHDRAW_RELAY_COMMAND,
  leaveRelay,
  JOIN_COMMAND,
} from "./commands.js";
import { SharedEditors, SharedPresence } from "./editors.js";
import { ActiveShares, connectDesktopShare, removeShareDir, ShareKeys } from "./session.js";

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
      void vscode.window.showInformationMessage(`Shared project "${formatProjectName(project)}": paste the invite to reconnect.`, join).then((choice) => {
        if (choice === join) { void vscode.commands.executeCommand(JOIN_COMMAND); }
      });
    },
    failed: (project, error) => {
      void vscode.window.showErrorMessage(`LabShelf could not reconnect the shared project "${formatProjectName(project)}": ${formatError(error)}`);
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
  // The LabShelf editor lists and adds the file's threads through the controller while it runs.
  provideSourceFileComments(comments);
  context.subscriptions.push(
    comments,
    { dispose: () => provideSourceFileComments(undefined) },
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
  /** The extension's global state, which keeps each library's contacts and its invitations switch. */
  state: vscode.Memento;
  /** Runs for each share connected again on start, such as to publish the own card into it. */
  onResumed?(connection: ShareConnection): void;
}

const identityKey = (libraryId: string): string => `labshelf.collab.identity.${libraryId}`;
const contactsKey = (libraryId: string): string => `labshelf.collab.contacts.${libraryId}`;
const pinsKey = (libraryId: string): string => `labshelf.collab.emailPins.${libraryId}`;
const enabledKey = (libraryId: string): string => `labshelf.collab.invitationsEnabled.${libraryId}`;

export interface InvitationStoreDeps {
  secrets: vscode.SecretStorage;
  /** The extension's global state, which outlives the window. */
  state: vscode.Memento;
  /** The open library's device identity; each library keeps its own identity, contacts and switch. */
  libraryId(): Promise<string>;
  accessToken(): Promise<string>;
}

/** Malformed values read as absent. */
export function createInvitationPorts(deps: InvitationStoreDeps): InvitationPorts {
  const { secrets, state } = deps;
  return {
    identity: {
      async load() {
        const raw = await secrets.get(identityKey(await deps.libraryId()));
        if (!raw) { return undefined; }
        try {
          const parsed: unknown = JSON.parse(raw);
          return isIdentityJwk(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      },
      async save(jwk) {
        await secrets.store(identityKey(await deps.libraryId()), JSON.stringify(jwk));
      },
    },
    contacts: {
      async read() {
        const stored = state.get<unknown>(contactsKey(await deps.libraryId()));
        return Array.isArray(stored) && stored.every(isContact) ? stored.map((contact) => ({ ...contact })) : [];
      },
      async write(contacts) {
        await state.update(contactsKey(await deps.libraryId()), contacts.map((contact) => ({ ...contact })));
      },
    },
    emailPins: {
      async read() {
        const stored = state.get<unknown>(pinsKey(await deps.libraryId()));
        return Array.isArray(stored) && stored.every(isEmailPin) ? stored.map((pin) => ({ ...pin })) : [];
      },
      async write(pins) {
        await state.update(pinsKey(await deps.libraryId()), pins.map((pin) => ({ ...pin })));
      },
    },
    enabled: {
      async get() {
        return state.get<unknown>(enabledKey(await deps.libraryId())) === true;
      },
      async set(on) {
        await state.update(enabledKey(await deps.libraryId()), on);
      },
    },
    accessToken: () => deps.accessToken(),
  };
}

/** The Cloudflare access token of the stored relay account; throws without one, which invitations treat as off. */
function createAccessToken(relay: RelayAccountStore, logger: ILogger): () => Promise<string> {
  return async () => {
    const account = await relay.get();
    if (!account) { throw new Error("Cloudflare is not connected"); }
    // A refused sign-in is not offered again here: this runs in the background, and the relay commands ask when the user acts on them.
    const reader = createAccessTokenReader(
      { store: relay, fetch: globalThis.fetch, logger, clock: systemRelayClock, signInAgain: async () => false }, account.credential,
    );
    return reader();
  };
}

function openRoot(libraryRoot: () => string | undefined): string {
  const root = libraryRoot();
  if (!root) { throw new Error("no library is open"); }
  return root;
}

/**
 * The invitation stores of the library open now. The root is read here, once, so an operation still running after a change of library
 * keeps reading and writing its own library's stores; a window with no library open gets ports that refuse.
 */
export function createCapturedInvitationPorts(deps: CollabPortsDeps): InvitationPorts {
  const root = deps.libraryRoot();
  let id: Promise<string> | undefined;
  const libraryId = (): Promise<string> => {
    if (!root) { return Promise.reject(new Error("no library is open")); }
    id ??= createDeviceIdentity(createDeviceLocalLayout(root), deps.logger).id();
    return id;
  };
  return createInvitationPorts({ secrets: deps.secrets, state: deps.state, libraryId, accessToken: createAccessToken(deps.relay, deps.logger) });
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
      const connecting = connectDesktopShare({ libraryRoot: openRoot(deps.libraryRoot), shareId, shareKey, relays, name: userName(), logger, isEditorOwned }, start);
      return start.mode === "resume" && deps.onResumed ? connecting.then((connection) => { deps.onResumed?.(connection); return connection; }) : connecting;
    },
    deleteState: (shareId) => removeShareDir(openRoot(deps.libraryRoot), shareId),
    userName,
    logger,
  };
}

/** The collaboration host with this window's invitations by email, which the sharing host and the relay rotation use. */
export interface InvitingCollabHost extends CollabHost { invitations: Invitations }

/**
 * Invitations that follow the open library: the identity, contacts and held list belong to one library, so a change of library
 * builds a new instance (empty list, its own identity) and tells the listeners the list is now empty.
 */
export function createLibraryInvitations(libraryRoot: () => string | undefined, create: () => Invitations): Invitations {
  const listeners = new Set<(invitations: InvitationView[]) => void>();
  let current: { root: string | undefined; invitations: Invitations; stop(): void } | undefined;
  const active = (): Invitations => {
    const root = libraryRoot();
    if (current && current.root === root) { return current.invitations; }
    const previous = current;
    previous?.stop();
    const invitations = create();
    const stop = invitations.onInvitationsChange((list) => { for (const listener of [...listeners]) { listener(list); } });
    current = { root, invitations, stop };
    if (previous) { for (const listener of [...listeners]) { listener([]); } }
    return invitations;
  };
  return {
    invitations: () => active().invitations(),
    refreshInvitations: () => active().refreshInvitations(),
    onInvitationsChange: (listener) => {
      listeners.add(listener);
      active();
      return () => { listeners.delete(listener); };
    },
    acceptInvitation: (id, signal) => active().acceptInvitation(id, signal),
    declineInvitation: (id) => active().declineInvitation(id),
    inviteByEmail: (request) => active().inviteByEmail(request),
    contacts: () => active().contacts(),
    invitationsEnabled: () => active().invitationsEnabled(),
    setInvitationsEnabled: (on) => active().setInvitationsEnabled(on),
    publishCard: (connection) => active().publishCard(connection),
    updateAfterRotation: (change) => active().updateAfterRotation(change),
  };
}

type Controller = Pick<LibraryRootController, "currentRoot" | "currentServices" | "require">;

function createHost(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): InvitingCollabHost {
  const logger = openLibraryLogger(controller);
  const libraryRoot = () => controller.currentRoot()?.fsPath;
  // The editors and the presence read the shares through these closures, which run only after `shares` exists.
  const editors: SharedEditors = new SharedEditors(() => shares.list(), logger);
  const presence: SharedPresence = new SharedPresence(editors, () => shares.list(), userName());
  const shares: ActiveShares = new ActiveShares((share) => vscode.Disposable.from(editors.attach(share), presence.watch(share)));
  context.subscriptions.push(editors, presence, shares);
  const relay = openRelayAccounts(context.secrets, logger);
  // Built once over the ports; the resumed connections, the sharing host and the rotation all use it.
  const ports: ShareFlowPorts = createCollabPorts({
    secrets: context.secrets, state: context.globalState, libraryRoot, logger, projects, shares, editors, relay,
    onResumed: (connection) => {
      void invitations.publishCard(connection).catch((error: unknown) => logger.error("collab", error, { action: "publish the card", shareId: connection.shareId }));
    },
  });
  const portsDeps: CollabPortsDeps = {
    secrets: context.secrets, state: context.globalState, libraryRoot, logger, projects, shares, editors, relay,
  };
  // Each instance takes the stores of the library open when it is made.
  const invitations: Invitations = createLibraryInvitations(libraryRoot, () => createInvitations({ ...ports, invitations: createCapturedInvitationPorts(portsDeps) }));
  return {
    libraryRoot,
    requireLibrary: async () => { await controller.require(); return libraryRoot(); },
    logger, projects, shares, editors, relay, ports, invitations,
  };
}

function registerSuggestions(context: vscode.ExtensionContext, deps: SuggestionsDeps): void {
  const suggestions = new SuggestionsController(deps);
  // The LabShelf editor lists, adds and removes the file's tracked changes through the store while it runs.
  provideSourceFileSuggestions(suggestions);
  context.subscriptions.push(suggestions, { dispose: () => provideSourceFileSuggestions(undefined) });
}

/** Returns the collaboration host, which the desktop sharing host shares projects over. */
export function registerCollab(context: vscode.ExtensionContext, controller: Controller, projects: WritingProjects): InvitingCollabHost {
  const host = createHost(context, controller, projects);
  registerShareStatusBar(context, host);
  const noticeFailures = createStoreFailureNotices(host.ports, "window", (message) => { void vscode.window.showErrorMessage(message); });
  // `updateRegistration` moves the directory registration and the cards on a rotation; registerRelay passes it on to the rotation's deps.
  const relayDeps: Parameters<typeof registerRelay>[1] = {
    accounts: host.relay, logger: host.logger,
    offerToShares: async () => { (await offerOwnRelayToShares(host.ports)).forEach(showRefusedOffer); },
    withdrawFromShares: (relayUrl) => removeOwnRelayOfferFromShares(host.ports, relayUrl),
    hasOpenShare: () => host.ports.shares.list().length > 0,
    updateRegistration: (change) => host.invitations.updateAfterRotation(change),
  };
  registerRelay(context, relayDeps);
  // Never awaited: activation does not wait on the network. A closed library has no inbox to read.
  const refreshOpenLibrary = (): void => {
    if (host.libraryRoot()) {
      void host.invitations.refreshInvitations().catch((error: unknown) => host.logger.error("collab", error, { action: "read the invitations" }));
    }
  };
  refreshOpenLibrary();
  registerComments(context, { projects, shares: host.shares, userName: userName(), logger: host.logger });
  registerSuggestions(context, { projects, shares: host.shares, author: userName(), logger: host.logger });
  context.subscriptions.push(
    registerProjectDialogCommands(host.requireLibrary),
    vscode.commands.registerCommand(OFFER_RELAY_COMMAND, () => offerRelay(host)),
    vscode.commands.registerCommand(WITHDRAW_RELAY_COMMAND, () => leaveRelay(host)),
    resumeShares(host),
    // A change of library swaps the invitations for the new library's; the throttle keeps this to one read a minute.
    host.projects.onDidChange(refreshOpenLibrary),
    host.shares.onDidChange(noticeFailures),
  );
  return host;
}
