// Holds the page's shared projects: joins one, reconnects one after a reload, and hands the editor its session, presence and comments.
import type { ILogger, RelayNetwork } from "@labshelf/core";
import type { ShareSources } from "./browserShareConnection";
import { joinProjectShare } from "./joinProjectShare";
import { adoptUnscopedShares } from "./migrations";
import { ProjectShare, type ShareEntryOptions, type ShareEntryState } from "./projectShareEntry";
import { loadDisplayName, loadShare, saveDisplayName } from "./shareKeyStore";

const LOG_MODULE = "collab.shares";
const DEFAULT_NAME = "Guest";

type ActiveShare = NonNullable<ReturnType<ProjectShare["active"]>>;

export interface PageShares {
  join(inviteText: string): Promise<{ projectId: string; folder: string }>;
  /** Runs a project joined earlier from its stored key and relays, or observes it while another tab runs it; repeated calls do nothing. */
  connect(projectId: string, shareId: string, folder: string): Promise<void>;
  /** Takes a project over from the tab that runs it ("Use here"). */
  takeOver(projectId: string): Promise<void>;
  active(projectId: string): ActiveShare | undefined;
  state(projectId: string): ShareEntryState | undefined;
  /** The name on this user's comments and cursor. */
  name(): string;
  setName(name: string): Promise<void>;
  /** Called whenever a project's state or its connection's state changes. */
  onChange(listener: () => void): () => void;
  closeAll(): Promise<void>;
}

export interface PageSharesOptions {
  sources: ShareSources;
  /** The id of the library the sources serve at the time of the call; the user can switch libraries while the page is open. */
  libraryId: () => Promise<string>;
  logger: ILogger;
  /** Tests pass relays that run in process. */
  network?: RelayNetwork;
}

export function createPageShares(options: PageSharesOptions): PageShares {
  return new PageShareRegistry(options);
}

class PageShareRegistry implements PageShares {
  private readonly entries = new Map<string, ProjectShare>();
  private readonly connecting = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private readonly joins = new Set<AbortController>();
  private readonly listeners = new Set<() => void>();
  private displayName = DEFAULT_NAME;
  private readonly notify = (): void => this.listeners.forEach((listener) => listener());

  constructor(private readonly options: PageSharesOptions) {
    void loadDisplayName().then(
      (stored) => { if (stored !== undefined && stored !== "") { this.displayName = stored; } },
      (error: unknown) => options.logger.error(LOG_MODULE, error, { action: "read display name" }),
    );
  }

  async join(inviteText: string): Promise<{ projectId: string; folder: string }> {
    const library = await this.options.libraryId();
    const abort = new AbortController();
    this.joins.add(abort);
    try {
      const { projectId, share } = await joinProjectShare({
        inviteText, libraryId: library, sources: this.options.sources, name: this.displayName, logger: this.options.logger,
        network: this.options.network, signal: abort.signal, entry: (id, folder, invite) => this.entryOptions(id, folder, library, invite),
      });
      if (abort.signal.aborted) {
        await share.close();
        throw new Error("Joining was cancelled because the page closed");
      }
      this.entries.set(projectId, share);
      return { projectId, folder: share.folder };
    } finally {
      this.joins.delete(abort);
    }
  }

  connect(projectId: string, shareId: string, folder: string): Promise<void> {
    const running = this.connecting.get(projectId);
    if (running) { return running; }
    if (this.entries.has(projectId)) { return Promise.resolve(); }
    this.failed.delete(projectId);
    const pending = this.open(projectId, shareId, folder).catch((error: unknown) => {
      this.entries.delete(projectId);
      this.failed.add(projectId);
      this.notify();
      throw error;
    }).finally(() => this.connecting.delete(projectId));
    this.connecting.set(projectId, pending);
    return pending;
  }

  async takeOver(projectId: string): Promise<void> { await this.entries.get(projectId)?.takeOver(); }

  active(projectId: string): ActiveShare | undefined { return this.entries.get(projectId)?.active(); }

  state(projectId: string): ShareEntryState | undefined {
    return this.failed.has(projectId) ? { kind: "failed" } : this.entries.get(projectId)?.state();
  }

  name(): string { return this.displayName; }

  async setName(name: string): Promise<void> { this.displayName = name; await saveDisplayName(name); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async closeAll(): Promise<void> {
    this.joins.forEach((abort) => abort.abort());
    const closing = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(closing.map((entry) => entry.close()));
    this.notify();
  }

  private async open(projectId: string, shareId: string, folder: string): Promise<void> {
    const library = await this.options.libraryId();
    // The project was read from this library's folder, so its share id belongs to this library.
    await adoptUnscopedShares(library, [shareId]);
    const stored = await loadShare(library, shareId);
    if (stored === undefined) { throw new Error(`The key of share ${shareId} is not stored on this device, so project ${projectId} cannot reconnect`); }
    const entry = new ProjectShare(this.entryOptions(projectId, folder, library, { shareId, ...stored }));
    this.entries.set(projectId, entry);
    await entry.open();
  }

  private entryOptions(projectId: string, folder: string, libraryId: string, invite: ShareEntryOptions["invite"]): ShareEntryOptions {
    const { sources, logger, network } = this.options;
    return { projectId, folder, libraryId, invite, sources, name: () => this.displayName, logger, network, notify: this.notify };
  }
}
