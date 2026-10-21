// Runs one shared project in this page while the page holds the share's tab lease, and waits for the lease while another tab does.
// CONTRACT: documents/contracts/collaboration.md#persistence-acknowledgment
import type { ILogger, ShareConnection, ShareConnectionState } from "@labshelf/core";
import { takeOverTabLease, tabLeaseName, waitForTabLease, type TabLease } from "../../../storage";
import type { CommentThreads } from "../../review";
import { createLiveCommentThreads } from "./liveCommentThreads";

const LOG_MODULE = "collab.shares";

export type ShareEntryState = { kind: "observer" } | { kind: "connected"; connection: ShareConnectionState };

/** What the editor and the comments of a shared project use while this page runs its connection. */
export interface LiveShare {
  session: ShareConnection["session"];
  presence: ShareConnection["presence"];
  comments: CommentThreads;
}

export interface ShareEntryOptions {
  shareId: string;
  libraryId: string;
  /** The project's id, which its comments carry; undefined when the project list does not hold it yet. */
  projectId: string | undefined;
  /** Opens the share again under `lease` once another tab let it go; undefined when this device holds no key of it any more. */
  reopen(lease: TabLease): Promise<ShareConnection | undefined>;
  name: () => string;
  logger: ILogger;
  /** Called on every state change of the entry or its connection. */
  notify(): void;
  /** Called once the entry stops for good without a close: its share was left while this tab waited. */
  ended(): void;
}

export class ProjectShare {
  private connection: ShareConnection | undefined;
  private comments: CommentThreads | undefined;
  private lease: TabLease | undefined;
  private waiting: AbortController | undefined;
  private stopState: (() => void) | undefined;
  private closed = false;

  constructor(private readonly options: ShareEntryOptions) {}

  get projectId(): string | undefined { return this.options.projectId; }

  get running(): ShareConnection | undefined { return this.connection; }

  live(): LiveShare | undefined {
    const { connection, comments } = this;
    return connection && comments ? { session: connection.session, presence: connection.presence, comments } : undefined;
  }

  state(): ShareEntryState {
    return this.connection ? { kind: "connected", connection: this.connection.state() } : { kind: "observer" };
  }

  /** Keeps a connection opened under `lease`. */
  adopt(lease: TabLease, connection: ShareConnection): void {
    this.waiting?.abort();
    this.lease = lease;
    lease.onLost(() => { if (this.lease === lease) { void this.lost(); } });
    this.connection = connection;
    const { projectId, logger, name } = this.options;
    this.comments = projectId === undefined ? undefined : createLiveCommentThreads({ session: connection.session, projectId, author: name, logger });
    this.stopState = connection.onStateChange(this.options.notify);
    this.options.notify();
  }

  /** Waits for the lease and reopens the share when another tab closes, dies or hands it over. */
  observe(): void {
    if (this.closed || this.connection || this.waiting) { return; }
    const waiting = this.waiting = new AbortController();
    this.options.notify();
    const { logger, shareId } = this.options;
    waitForTabLease(this.leaseName(), waiting.signal).then(
      (lease) => this.reopen(lease).catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "reopen a share after the lease came free", shareId })),
      (error: unknown) => { if (!waiting.signal.aborted) { void logger.error(LOG_MODULE, error, { action: "wait for the share's tab lease", shareId }); } },
    ).finally(() => { if (this.waiting === waiting) { this.waiting = undefined; } });
  }

  /** Takes the lease from the tab that holds it ("Use here"); that tab then observes. */
  async takeOver(): Promise<void> {
    if (this.connection || this.closed) { return; }
    this.waiting?.abort();
    await this.reopen(await takeOverTabLease(this.leaseName()));
  }

  /** Stops waiting, closes the connection and frees the lease; rejects when the close leaves an update unstored. */
  async close(): Promise<void> {
    this.closed = true;
    this.waiting?.abort();
    try {
      await this.disconnect();
    } finally {
      await this.lease?.release();
      this.lease = undefined;
    }
  }

  private leaseName(): string {
    return tabLeaseName(this.options.libraryId, this.options.shareId);
  }

  private async reopen(lease: TabLease): Promise<void> {
    if (this.closed) { await lease.release(); return; }
    let connection: ShareConnection | undefined;
    try {
      connection = await this.options.reopen(lease);
    } catch (error) {
      await lease.release();
      this.options.ended();
      throw error;
    }
    if (connection && !this.closed) { this.adopt(lease, connection); return; }
    await connection?.close().catch((error: unknown) =>
      this.options.logger.error(LOG_MODULE, error, { action: "close a share reopened while the page closed", shareId: this.options.shareId }));
    await lease.release();
    if (!connection) { this.options.ended(); }
  }

  /**
   * Another tab took the lease: the mirror already stopped writing, so the connection closes and this tab observes.
   * INVARIANT: closing still flushes this tab's pending updates to the share's state; appends only add, so the new owner loses none.
   */
  private async lost(): Promise<void> {
    const { logger, shareId } = this.options;
    void logger.log("INFO", LOG_MODULE, "Another tab took the shared project over", { shareId });
    this.lease = undefined;
    await this.disconnect().catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "close a share another tab took over", shareId }));
    this.observe();
  }

  private async disconnect(): Promise<void> {
    const { connection } = this;
    this.connection = undefined;
    this.comments = undefined;
    this.stopState?.();
    this.stopState = undefined;
    if (!connection) { return; }
    this.options.notify();
    await connection.close();
  }
}
