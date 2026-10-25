// Holds the page's shared project connections, one per share and each under its tab lease, as the core share workflows use them.
import { ShareOpenInAnotherTabError, type ILogger, type RelayNetwork, type ShareConnection, type ShareConnections, type ShareKeyStore, type ShareStart, type StoredInvite } from "@labshelf/core";
import { openTabLease, createTabLeaseName, type TabLease } from "../storage";
import { connectBrowserShare, type ShareSources } from "./browserShareConnection";
import { ProjectShare, type LiveShare, type ShareEntryState } from "./projectShareEntry";
import { loadDisplayName } from "./shareKeyStore";

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
  private readonly listeners = new Set<() => void>();
  private displayName = DEFAULT_DISPLAY_NAME;
  private closed = false;
  private readonly notify = (): void => this.listeners.forEach((listener) => listener());

  constructor(private readonly options: PageSharesOptions) {
    void loadDisplayName().then(
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
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
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
