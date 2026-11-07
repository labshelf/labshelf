// Runs the page's shares: the connections it holds, one per share and each under its tab lease, the workflow ports over them and the resume reports; it also keeps the invitation setting of each library (identity with its private keys, contacts, email pins and the switch) in extension storage, apart per library.
import {
  ShareOpenInAnotherTabError, createAccessTokenReader, createInvitations, createListeners, createShareRegistry, createShareResumer, startProjectShare, posixPathOps, formatError,
  isContact, isEmailPin, isIdentityJwk,
  type Invitations, type InvitationPorts, type ILogger, type ProjectEntry, type RelayAccount, type RelayAccountDeps, type RelayNetwork, type ResumeReports, type ShareConnection, type ShareConnections, type ShareFlowPorts,
  type ShareKeyStore, type OpenShareRegistry, type ShareKind, type ShareStart, type SharedProject, type SpaceShareDeps, type StoredInvite,
} from "@labshelf/core";
import { showDialog, showToast } from "@labshelf/core/dom";
import { bx } from "../platform";
import { openTabLease, createTabLeaseName, removeBrowserCollabDocs, type TabLease } from "../storage";
import { createBackgroundRelayDeps, onRelayRotated } from "../relay";
import { createShareKeyStore, readMemberName, SHARES_STORAGE_KEY } from "./keys";
import { ProjectShare, connectBrowserShare, type LiveShare, type ShareEntryState, type ShareSources } from "./register";
import { createBrowserShareCatalog, createSpaceShareCatalog, createSpaceShareDeps, runSpaceShares, type BrowserShareCatalog, type PageShareSpaces } from "./spaceShares";

const LOG_MODULE = "collab.shares";
export const DEFAULT_DISPLAY_NAME = "Guest";

// INVARIANT: extension-local storage only, since the identity holds private keys; sync storage would copy them to other devices.
// Each record has its own key, so nothing here ever writes `collabShares`.
const identityKey = (libraryId: string): string => `collabIdentity.${libraryId}`;
const contactsKey = (libraryId: string): string => `collabContacts.${libraryId}`;
const pinsKey = (libraryId: string): string => `collabEmailPins.${libraryId}`;
const enabledKey = (libraryId: string): string => `collabInvitationsEnabled.${libraryId}`;

async function readRecord(key: string): Promise<unknown> {
  return ((await bx.storage.local.get(key)) as Record<string, unknown>)[key];
}

/** Calls `onName` with the stored display name, then again each time the stored one changes; undefined or "" when none is stored. Returns what stops following. */
export function followMemberName(onName: (name: string | undefined) => void, logger: ILogger): () => void {
  let changed = false;
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== "local" || !(SHARES_STORAGE_KEY in changes)) { return; }
    changed = true;
    const record = changes[SHARES_STORAGE_KEY]?.newValue;
    const name = record !== null && typeof record === "object" ? (record as Record<string, unknown>)["displayName"] : undefined;
    onName(typeof name === "string" ? name : undefined);
  };
  bx.storage.onChanged.addListener(listener);
  void readMemberName().then(
    // A change seen while the read ran is newer than the read.
    (stored) => { if (!changed) { onName(stored); } },
    (error: unknown) => logger.error(LOG_MODULE, error, { action: "read display name" }),
  );
  return () => bx.storage.onChanged.removeListener(listener);
}

export interface BrowserInvitationOptions {
  /** The id of the library open at the time of each call; the user can switch libraries while the page is open. */
  libraryId: () => Promise<string>;
  relay: { get(): Promise<RelayAccount | undefined> };
  /** The relay account's deps, made when the first token is read. */
  relayDeps: () => RelayAccountDeps;
}

/** The invitation port of one page; a missing or malformed record reads as absent. */
export function createBrowserInvitationPorts(options: BrowserInvitationOptions): InvitationPorts {
  const { libraryId, relay } = options;
  const write = async (key: (id: string) => string, value: unknown): Promise<void> => {
    await bx.storage.local.set({ [key(await libraryId())]: value });
  };
  const read = async (key: (id: string) => string): Promise<unknown> => readRecord(key(await libraryId()));
  return {
    identity: {
      load: async () => {
        const stored = await read(identityKey);
        return isIdentityJwk(stored) ? stored : undefined;
      },
      save: (jwk) => write(identityKey, jwk),
    },
    contacts: {
      read: async () => {
        const stored = await read(contactsKey);
        return Array.isArray(stored) && stored.every(isContact) ? stored : [];
      },
      write: (contacts) => write(contactsKey, contacts),
    },
    emailPins: {
      read: async () => {
        const stored = await read(pinsKey);
        return Array.isArray(stored) && stored.every(isEmailPin) ? stored : [];
      },
      write: (pins) => write(pinsKey, pins),
    },
    enabled: {
      get: async () => (await read(enabledKey)) === true,
      set: (on) => write(enabledKey, on),
    },
    accessToken: async () => {
      const account = await relay.get();
      if (!account) { throw new Error("Connect Cloudflare first"); }
      return createAccessTokenReader(options.relayDeps(), account.credential)();
    },
  };
}

export interface PageShares extends ShareConnections {
  /** Opens a share under its tab lease; a resume the lease refuses observes the share and rejects with ShareOpenInAnotherTabError. */
  connect(invite: StoredInvite, start: ShareStart): Promise<ShareConnection>;
  /** The live share of a project, while this page runs its connection. */
  live(projectId: string): LiveShare | undefined;
  state(shareId: string): ShareEntryState | undefined;
  /** Takes a share over from the tab that runs it ("Use here"). */
  takeOver(shareId: string): Promise<void>;
  /** The name on this user's comments and cursor. */
  name(): string;
  /** Called whenever a share's state or its connection's state changes. */
  onChange(listener: () => void): () => void;
  closeAll(): Promise<void>;
}

export interface PageSharesOptions {
  sources: ShareSources;
  /** The id of the library the sources serve at the time of the call; the user can switch libraries while the page is open. */
  libraryId: () => Promise<string>;
  keys: Pick<ShareKeyStore, "invite">;
  /** The id of the project in `folder`, from the project list. */
  projectIdOf(folder: string): string | undefined;
  logger: ILogger;
  /** Tests pass relays that run in process. */
  network?: RelayNetwork | undefined;
}

export function createPageShares(options: PageSharesOptions): PageShares {
  return new PageShareRegistry(options);
}

class PageShareRegistry implements PageShares {
  private readonly entries: OpenShareRegistry<ProjectShare> = createShareRegistry<ProjectShare>({
    connectionOf: (entry) => entry.running,
    close: (entry) => entry.close(),
  });
  /** Leases of connections opened but not yet added. */
  private readonly opened = new Map<string, { lease: TabLease; libraryId: string }>();
  private displayName = DEFAULT_DISPLAY_NAME;
  private closed = false;
  private readonly notify = (): void => this.entries.notify();
  // Open connections keep the presence name they started with until they reconnect.
  private readonly stopName: () => void;

  constructor(private readonly options: PageSharesOptions) {
    this.stopName = followMemberName((stored) => { this.displayName = stored === undefined || stored === "" ? DEFAULT_DISPLAY_NAME : stored; }, options.logger);
  }

  async connect(invite: StoredInvite, start: ShareStart): Promise<ShareConnection> {
    if (this.closed) { throw new Error(`The page is closing, so it opens no connection of share ${invite.shareId}`); }
    const libraryId = await this.options.libraryId();
    const held = await openTabLease(createTabLeaseName(libraryId, invite.shareId));
    if (held.kind === "busy") {
      if (start.mode === "resume") { this.entry(invite.shareId, libraryId, start.folder, start.kind).observe(); }
      throw new ShareOpenInAnotherTabError(invite.shareId);
    }
    try {
      const connection = await this.open(invite, libraryId, held.lease, start);
      this.opened.set(invite.shareId, { lease: held.lease, libraryId });
      return connection;
    } catch (error) {
      await held.lease.release();
      throw error;
    }
  }

  add(connection: ShareConnection): void {
    const opened = this.opened.get(connection.shareId);
    if (!opened) { throw new Error(`Share ${connection.shareId} was not opened by this page, so this page holds no tab lease of it`); }
    this.opened.delete(connection.shareId);
    if (this.closed) {
      // The page closed while the share connected; nothing waits for this close.
      void connection.close().catch((error: unknown) => this.options.logger.error(LOG_MODULE, error, { action: "close a share that connected as the page closed", shareId: connection.shareId }))
        .finally(() => opened.lease.release());
      return;
    }
    this.entry(connection.shareId, opened.libraryId, connection.folder, connection.kind, connection.joinedId).adopt(opened.lease, connection);
  }

  remove(shareId: string): Promise<void> { return this.entries.remove(shareId); }

  active(shareId: string): ShareConnection | undefined { return this.entries.active(shareId); }

  list(): ShareConnection[] { return this.entries.list(); }

  isBusy(shareId: string): boolean { return this.entries.isBusy(shareId); }

  hold<T>(shareId: string, run: () => Promise<T>): Promise<T> { return this.entries.hold(shareId, run); }

  live(projectId: string): LiveShare | undefined {
    return this.entries.entries().find((entry) => entry.projectId === projectId)?.live();
  }

  state(shareId: string): ShareEntryState | undefined { return this.entries.entry(shareId)?.state(); }

  async takeOver(shareId: string): Promise<void> { await this.entries.entry(shareId)?.takeOver(); }

  name(): string { return this.displayName; }

  onChange(listener: () => void): () => void { return this.entries.onChange(listener); }

  async closeAll(): Promise<void> {
    this.closed = true;
    this.stopName();
    const failures = await this.entries.closeAll();
    failures.forEach(({ shareId, reason }) => { void this.options.logger.error(LOG_MODULE, reason, { action: "close a share as the page closed", shareId }); });
  }

  private open(invite: StoredInvite, libraryId: string, tab: TabLease, start: ShareStart): Promise<ShareConnection> {
    const { sources, logger, network } = this.options;
    return connectBrowserShare({ invite, libraryId, tab, sources, name: this.displayName, logger, network, start });
  }

  /** The share's entry, made when the page has none; `joinedId` names the project a join created. A Space share has no project, so no comments. */
  private entry(shareId: string, libraryId: string, folder: string, kind: ShareKind | undefined, joinedId?: string): ProjectShare {
    const existing = this.entries.entry(shareId);
    if (existing) { return existing; }
    const projectId = kind === "space" ? undefined : joinedId ?? this.options.projectIdOf(folder);
    if (projectId === undefined && kind !== "space") {
      void this.options.logger.log("WARN", LOG_MODULE, "The project list does not hold a shared project, so its comments stay off the share", { shareId, folder });
    }
    const entry: ProjectShare = new ProjectShare({
      shareId, libraryId, projectId, logger: this.options.logger, name: () => this.displayName, notify: this.notify,
      reopen: async (lease) => {
        const stored = await this.options.keys.invite(shareId);
        return stored && this.open(stored, libraryId, lease, { mode: "resume", folder, ...(kind === undefined ? {} : { kind }) });
      },
      ended: () => this.entries.release(shareId, entry),
    });
    this.entries.set(shareId, entry);
    return entry;
  }
}

interface BrowserSharePortsOptions {
  sources: ShareSources;
  libraryId: () => Promise<string>;
  keys: ShareKeyStore;
  shares: PageShares;
  projects: BrowserShareCatalog;
  spaces: ShareFlowPorts["spaces"];
  relay: { get(): Promise<RelayAccount | undefined> };
  requireRelay(): Promise<boolean>;
  logger: ILogger;
  fetch?: typeof fetch | undefined;
  invitations: InvitationPorts;
  /** Called with every connection a resume opens; the invitations object exists only once the ports do. */
  resumed(connection: ShareConnection): void;
}

// INVARIANT: one invitations object per ports, so the page host, the resume and the rotation share its inbox list and its listeners.
const invitationsByPorts = new WeakMap<ShareFlowPorts, Invitations>();

/** The invitations of these ports, built on first use. */
export function invitationsOf(ports: ShareFlowPorts): Invitations {
  let invitations = invitationsByPorts.get(ports);
  if (!invitations) { invitations = createInvitations(ports); invitationsByPorts.set(ports, invitations); }
  return invitations;
}

function createBrowserSharePorts(options: BrowserSharePortsOptions): ShareFlowPorts {
  const { sources, libraryId, keys, shares, projects, spaces, relay, requireRelay, logger, invitations } = options;
  return {
    keys, shares, projects, ...(spaces ? { spaces } : {}), relay, requireRelay, logger, invitations,
    files: { fs: sources.fileSystem, paths: posixPathOps, logger },
    connect: async (invite, start) => {
      const connection = await shares.connect(invite, start);
      if (start.mode === "resume") { options.resumed(connection); }
      return connection;
    },
    deleteState: async (shareId) => removeBrowserCollabDocs(`${await libraryId()}/${shareId}`),
    userName: () => shares.name(),
    // PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome.
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  };
}

const SHARING_MODULE = "collab.sharing";

export interface PageShareOptions {
  sources: ShareSources;
  libraryId: () => Promise<string>;
  logger: ILogger;
  /** The owner's Cloudflare relay account, when this browser connected one. */
  relay: { get(): Promise<RelayAccount | undefined> };
  /** Offers to connect a relay; false when the owner did not. */
  requireRelay(): Promise<boolean>;
  /** What the resume reports once per share. */
  reports: ResumeReports;
  /** Tests pass relays that run in process. */
  network?: RelayNetwork;
  fetch?: typeof fetch;
  /** The page's Spaces; without them the page shares no Space. */
  spaces?: PageShareSpaces | undefined;
}

export interface PageShare {
  ports: ShareFlowPorts;
  shares: PageShares;
  /** Resolves once the first read of the project list and the resume it starts are done. */
  ready(): Promise<void>;
  /** Re-reads the project list and resumes or closes the shares it changed. */
  reload(): Promise<void>;
  /** Calls `listener` after every re-read of the project list, the ones a share, join or leave makes included. */
  onProjectsChange(listener: () => void): () => void;
  /** What the Space page's share operations run on; undefined without the page's Spaces. */
  spaceDeps: SpaceShareDeps | undefined;
  /** Calls `listener` when a share or its connection changes and after every re-read of the Spaces. */
  onSpaceShareChange(listener: () => void): () => void;
  /** The live share of a shared project's file; `retry` reconnects it from its stored key instead of waiting for the resume. */
  liveShare(entry: ProjectEntry, retry: boolean): Promise<LiveShare | undefined>;
  closeAll(): Promise<void>;
}

interface LiveShareDeps {
  ports: ShareFlowPorts;
  shares: PageShares;
  resumer: { sync(): Promise<void> };
  first: Promise<unknown>;
  signal: AbortSignal;
}

async function liveShareOf(deps: LiveShareDeps, entry: ProjectEntry, retry: boolean): Promise<LiveShare | undefined> {
  if (entry.kind !== "ready" || entry.settings.shared === undefined) { return undefined; }
  await deps.first;
  if (retry) { await startProjectShare(deps.ports, { folder: entry.folder, shared: entry.settings.shared, signal: deps.signal }); } else { await deps.resumer.sync(); }
  return deps.shares.live(entry.settings.id);
}

export function createPageShare(options: PageShareOptions): PageShare {
  const { sources, libraryId, logger } = options;
  const keys = createShareKeyStore(libraryId);
  const closing = new AbortController();
  // The resumer runs on every reload of the catalog, which the workflows call too; it exists once the ports do.
  let sync = (): Promise<void> => Promise.resolve();
  const listeners = createListeners();
  const catalog = createBrowserShareCatalog(sources, logger, () => {
    if (closing.signal.aborted) return;
    void sync();
    listeners.emit();
  });
  const projectIdOf = (folder: string): string | undefined => {
    const entry = catalog.list().find((candidate) => candidate.folder === folder);
    return entry?.kind === "ready" ? entry.settings.id : undefined;
  };
  const shares = createPageShares({ sources, libraryId, keys, projectIdOf, logger, network: options.network });
  const invitationPorts = createBrowserInvitationPorts({
    libraryId, relay: options.relay, relayDeps: () => createBackgroundRelayDeps(logger, options.fetch ? { fetch: options.fetch } : {}),
  });
  // A card written on resume reaches the share's members, so a failure only costs the cards of this run.
  const publishResumed = (connection: ShareConnection): void => {
    void invitationsOf(ports).publishCard(connection).catch((error: unknown) => logger.error(SHARING_MODULE, error, { action: "publish the card", shareId: connection.shareId }));
  };
  const spaces = options.spaces;
  const ports: ShareFlowPorts = createBrowserSharePorts({
    sources, libraryId, keys, shares, projects: catalog, spaces: spaces && createSpaceShareCatalog(spaces.store), relay: options.relay, requireRelay: options.requireRelay, logger, fetch: options.fetch,
    invitations: invitationPorts, resumed: publishResumed,
  });
  const invitations = invitationsOf(ports);
  const stopRotationUpdates = onRelayRotated((change) => invitations.updateAfterRotation(change), logger);
  const resumer = createShareResumer(ports, options.reports);
  sync = resumer.sync;
  const onProjectsChange = (listener: () => void): (() => void) => listeners.add(listener);
  // A Space's `shared` changes through the store, so its reloads resume or close Space shares as the catalog's do projects.
  const stopSpaceSync = spaces?.store.onChange(() => { if (!closing.signal.aborted) void sync(); });
  const spaceDeps = spaces && createSpaceShareDeps(ports, spaces, onProjectsChange);
  const stopSpaceShares = spaceDeps && runSpaceShares(shares, spaceDeps);
  const reload = async (): Promise<void> => {
    if (!closing.signal.aborted) { await catalog.reload(); await resumer.sync(); }
  };
  const first = reload().catch((error: unknown) => logger.error(SHARING_MODULE, error, { action: "read the shared projects at page start" }));
  // Never awaited: the page does not wait on the inbox, and a failed read is logged and leaves the list empty.
  void first.then(() => invitations.refreshInvitations());
  return {
    ports, shares, reload,
    onProjectsChange, spaceDeps,
    onSpaceShareChange: (listener) => {
      const stops = [shares.onChange(listener), spaces?.store.onChange(listener)];
      return () => stops.forEach((stop) => stop?.());
    },
    ready: () => first,
    liveShare: (entry, retry) => liveShareOf({ ports, shares, resumer, first, signal: closing.signal }, entry, retry),
    closeAll: async () => {
      closing.abort();
      stopRotationUpdates();
      stopSpaceSync?.();
      stopSpaceShares?.();
      await shares.closeAll();
    },
  };
}

const projectName = (project: SharedProject): string => project.settings.title ?? project.settings.id;

/** `join` asks for an invite. */
export function createResumeReports(join: () => void): ResumeReports {
  return {
    missingKey: (project) => {
      void showDialog({
        title: `Shared project "${projectName(project)}": paste the invite to reconnect`,
        message: "This device holds no key of the share, so the project's files stay as they are until you join it again.",
        severity: "info",
        buttons: [{ id: "join" as const, label: "Join Shared Project…", primary: true }, { id: "later" as const, label: "Not Now" }],
      }).then((choice) => { if (choice === "join") { join(); } });
    },
    failed: (project, error) => {
      showToast(`Could not reconnect the shared project "${projectName(project)}": ${formatError(error)}`, "error");
    },
  };
}
