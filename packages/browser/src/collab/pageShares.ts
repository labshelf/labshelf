// Runs the page's shares: the connections it holds, one per share and each under its tab lease, the workflow ports over them and the resume reports.
import {
  ShareOpenInAnotherTabError, createListeners, createShareResumer, startProjectShare, posixPathOps, formatError,
  type ILogger, type ProjectEntry, type RelayAccount, type RelayNetwork, type ResumeReports, type ShareConnection, type ShareConnections, type ShareFlowPorts,
  type ShareKeyStore, type ShareStart, type SharedProject, type StoredInvite,
} from "@labshelf/core";
import { showDialog, showToast } from "@labshelf/core/dom";
import { openTabLease, createTabLeaseName, createBrowserProjects, removeBrowserCollabDocs, type TabLease } from "../storage";
import { createShareKeyStore, readMemberName } from "./keys";
import { ProjectShare, connectBrowserShare, type LiveShare, type ShareEntryState, type ShareSources } from "./register";

const LOG_MODULE = "collab.shares";
export const DEFAULT_DISPLAY_NAME = "Guest";

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
  private readonly entries = new Map<string, ProjectShare>();
  /** Leases of connections opened but not yet added. */
  private readonly opened = new Map<string, { lease: TabLease; libraryId: string }>();
  private readonly busy = new Set<string>();
  private readonly listeners = createListeners();
  private displayName = DEFAULT_DISPLAY_NAME;
  private closed = false;
  private readonly notify = (): void => this.listeners.emit();

  constructor(private readonly options: PageSharesOptions) {
    void readMemberName().then(
      (stored) => { if (stored !== undefined && stored !== "") { this.displayName = stored; } },
      (error: unknown) => options.logger.error(LOG_MODULE, error, { action: "read display name" }),
    );
  }

  async connect(invite: StoredInvite, start: ShareStart): Promise<ShareConnection> {
    if (this.closed) { throw new Error(`The page is closing, so it opens no connection of share ${invite.shareId}`); }
    const libraryId = await this.options.libraryId();
    const held = await openTabLease(createTabLeaseName(libraryId, invite.shareId));
    if (held.kind === "busy") {
      if (start.mode === "resume") { this.entry(invite.shareId, libraryId, start.folder).observe(); }
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
    this.entry(connection.shareId, opened.libraryId, connection.folder, connection.joinedId).adopt(opened.lease, connection);
  }

  async remove(shareId: string): Promise<void> {
    const entry = this.entries.get(shareId);
    if (!entry) { return; }
    this.entries.delete(shareId);
    this.notify();
    await entry.close();
  }

  active(shareId: string): ShareConnection | undefined { return this.entries.get(shareId)?.running; }

  list(): ShareConnection[] { return [...this.entries.values()].flatMap((entry) => (entry.running ? [entry.running] : [])); }

  isBusy(shareId: string): boolean { return this.busy.has(shareId); }

  async hold<T>(shareId: string, run: () => Promise<T>): Promise<T> {
    this.busy.add(shareId);
    try {
      return await run();
    } finally {
      this.busy.delete(shareId);
    }
  }

  live(projectId: string): LiveShare | undefined {
    return [...this.entries.values()].find((entry) => entry.projectId === projectId)?.live();
  }

  state(shareId: string): ShareEntryState | undefined { return this.entries.get(shareId)?.state(); }

  async takeOver(shareId: string): Promise<void> { await this.entries.get(shareId)?.takeOver(); }

  name(): string { return this.displayName; }


  onChange(listener: () => void): () => void {
    return this.listeners.add(listener);
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const closing = [...this.entries.entries()];
    this.entries.clear();
    const results = await Promise.allSettled(closing.map(([, entry]) => entry.close()));
    results.forEach((result, index) => {
      if (result.status === "rejected") { void this.options.logger.error(LOG_MODULE, result.reason, { action: "close a share as the page closed", shareId: closing[index]?.[0] }); }
    });
    this.notify();
  }

  private open(invite: StoredInvite, libraryId: string, tab: TabLease, start: ShareStart): Promise<ShareConnection> {
    const { sources, logger, network } = this.options;
    return connectBrowserShare({ invite, libraryId, tab, sources, name: this.displayName, logger, network, start });
  }

  /** The share's entry, made when the page has none; `joinedId` names the project a join created. */
  private entry(shareId: string, libraryId: string, folder: string, joinedId?: string): ProjectShare {
    const existing = this.entries.get(shareId);
    if (existing) { return existing; }
    const projectId = joinedId ?? this.options.projectIdOf(folder);
    if (projectId === undefined) {
      void this.options.logger.log("WARN", LOG_MODULE, "The project list does not hold a shared project, so its comments stay off the share", { shareId, folder });
    }
    const entry: ProjectShare = new ProjectShare({
      shareId, libraryId, projectId, logger: this.options.logger, name: () => this.displayName, notify: this.notify,
      reopen: async (lease) => {
        const stored = await this.options.keys.invite(shareId);
        return stored && this.open(stored, libraryId, lease, { mode: "resume", folder });
      },
      ended: () => { if (this.entries.get(shareId) === entry) { this.entries.delete(shareId); this.notify(); } },
    });
    this.entries.set(shareId, entry);
    return entry;
  }
}

/** The project list the workflows read; `reload` re-reads the library's projects and then calls `reloaded`. */
interface BrowserShareCatalog {
  list(): readonly ProjectEntry[];
  reload(): Promise<void>;
}

function createBrowserShareCatalog(sources: ShareSources, logger: ILogger, reloaded: () => void): BrowserShareCatalog {
  const projects = createBrowserProjects({ fileSystem: sources.fileSystem, logger });
  let entries: readonly ProjectEntry[] = [];
  return {
    list: () => entries,
    reload: async () => {
      entries = await projects.listBrowserProjects();
      reloaded();
    },
  };
}

interface BrowserSharePortsOptions {
  sources: ShareSources;
  libraryId: () => Promise<string>;
  keys: ShareKeyStore;
  shares: PageShares;
  projects: BrowserShareCatalog;
  relay: { get(): Promise<RelayAccount | undefined> };
  requireRelay(): Promise<boolean>;
  logger: ILogger;
  fetch?: typeof fetch | undefined;
}

function createBrowserSharePorts(options: BrowserSharePortsOptions): ShareFlowPorts {
  const { sources, libraryId, keys, shares, projects, relay, requireRelay, logger } = options;
  return {
    keys, shares, projects, relay, requireRelay, logger,
    files: { fs: sources.fileSystem, paths: posixPathOps, logger },
    connect: (invite, start) => shares.connect(invite, start),
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
}

export interface PageShare {
  ports: ShareFlowPorts;
  shares: PageShares;
  /** Resolves once the first read of the project list and the resume it starts are done. */
  ready(): Promise<void>;
  /** Re-reads the project list and resumes or closes the shares it changed. */
  reload(): Promise<void>;
  /** Calls `listener` after every re-read of the project list, the ones a share, join or leave makes included. */
  onProjectsChange(listener: () => void): void;
  /** The live share of a shared project's file; `retry` reconnects it from its stored key instead of waiting for the resume. */
  liveShare(entry: ProjectEntry, retry: boolean): Promise<LiveShare | undefined>;
  closeAll(): Promise<void>;
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
  const ports = createBrowserSharePorts({
    sources, libraryId, keys, shares, projects: catalog, relay: options.relay, requireRelay: options.requireRelay, logger, fetch: options.fetch,
  });
  const resumer = createShareResumer(ports, options.reports);
  sync = resumer.sync;
  const reload = async (): Promise<void> => {
    if (closing.signal.aborted) { return; }
    await catalog.reload();
    await resumer.sync();
  };
  const first = reload().catch((error: unknown) => logger.error(SHARING_MODULE, error, { action: "read the shared projects at page start" }));
  return {
    ports, shares, reload,
    onProjectsChange: (listener) => { listeners.add(listener); },
    ready: () => first,
    liveShare: async (entry, retry) => {
      if (entry.kind !== "ready" || entry.settings.shared === undefined) { return undefined; }
      await first;
      if (retry) { await startProjectShare(ports, { folder: entry.folder, shared: entry.settings.shared, signal: closing.signal }); } else { await resumer.sync(); }
      return shares.live(entry.settings.id);
    },
    closeAll: async () => {
      closing.abort();
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
