// Runs one shared project in this page while the page holds the share's tab lease, and waits for the lease while another tab does.
// CONTRACT: documents/contracts/collaboration.md#persistence-acknowledgment
import type { ILogger, Invite, RelayNetwork, ShareConnection, ShareConnectionState } from "@labshelf/core";
import { acquireTabLease, takeOverTabLease, tabLeaseName, waitForTabLease, type TabLease } from "../../../storage";
import type { CommentThreads } from "../../review";
import { connectBrowserShare, type ShareSources } from "./browserShareConnection";
import { createLiveCommentThreads } from "./liveCommentThreads";

const LOG_MODULE = "collab.shares";

export type ShareEntryState =
  | { kind: "connecting" | "observer" | "failed" }
  | { kind: "connected"; connection: ShareConnectionState };

export interface ShareEntryOptions {
  projectId: string;
  folder: string;
  libraryId: string;
  invite: Pick<Invite, "shareId" | "shareKey" | "relays">;
  sources: ShareSources;
  name: () => string;
  logger: ILogger;
  network?: RelayNetwork | undefined;
  /** Called on every state change of the entry or its connection. */
  notify(): void;
}

export class ProjectShare {
  private current: ShareEntryState = { kind: "connecting" };
  private connection: ShareConnection | undefined;
  private comments: CommentThreads | undefined;
  private lease: TabLease | undefined;
  private waiting: AbortController | undefined;
  private stopState: (() => void) | undefined;
  private closed = false;

  constructor(private readonly options: ShareEntryOptions) {}

  get folder(): string { return this.options.folder; }

  state(): ShareEntryState {
    return this.connection ? { kind: "connected", connection: this.connection.state() } : this.current;
  }

  active(): { session: ShareConnection["session"]; presence: ShareConnection["presence"]; comments: CommentThreads } | undefined {
    const { connection, comments } = this;
    return connection && comments ? { session: connection.session, presence: connection.presence, comments } : undefined;
  }

  /** Runs the share here when no other tab holds its lease; otherwise observes until the lease comes free. */
  async open(): Promise<void> {
    const result = await acquireTabLease(this.leaseName());
    if (result.kind === "busy") { this.observe(); return; }
    await this.resume(result.lease);
  }

  /** Takes the lease from the tab that holds it ("Use here"); that tab then observes. */
  async takeOver(): Promise<void> {
    if (this.connection || this.closed || this.current.kind === "connecting") { return; }
    this.waiting?.abort();
    await this.resume(await takeOverTabLease(this.leaseName()));
  }

  /** Keeps a connection a join opened under `lease`. */
  adopt(lease: TabLease, connection: ShareConnection): void {
    this.lease = lease;
    lease.onLost(() => { if (this.lease === lease) { void this.lost(); } });
    this.connection = connection;
    const { projectId, logger, name } = this.options;
    this.comments = createLiveCommentThreads({ session: connection.session, projectId, author: name, logger });
    this.stopState = connection.onStateChange(this.options.notify);
    this.options.notify();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.waiting?.abort();
    await this.disconnect();
    await this.lease?.release();
    this.lease = undefined;
  }

  private leaseName(): string {
    return tabLeaseName(this.options.libraryId, this.options.invite.shareId);
  }

  private set(state: ShareEntryState): void {
    this.current = state;
    this.options.notify();
  }

  private async resume(lease: TabLease): Promise<void> {
    if (this.closed) { await lease.release(); return; }
    this.set({ kind: "connecting" });
    const { invite, libraryId, sources, logger, network, folder } = this.options;
    let connection: ShareConnection;
    try {
      connection = await connectBrowserShare({ invite, libraryId, tab: lease, sources, name: this.options.name(), logger, network, start: { mode: "resume", folder } });
    } catch (error) {
      await lease.release();
      this.set({ kind: "failed" });
      throw error;
    }
    if (this.closed) {
      await connection.close().catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "close a share opened while the page closed", shareId: invite.shareId }));
      await lease.release();
      return;
    }
    this.adopt(lease, connection);
  }

  /** Waits for the lease and resumes when another tab closes, dies or hands it over. */
  private observe(): void {
    if (this.closed) { return; }
    this.set({ kind: "observer" });
    const waiting = this.waiting = new AbortController();
    const { logger, invite } = this.options;
    waitForTabLease(this.leaseName(), waiting.signal).then(
      (lease) => this.resume(lease).catch((error: unknown) => logger.error(LOG_MODULE, error, { action: "resume a share after the lease came free", shareId: invite.shareId })),
      (error: unknown) => { if (!waiting.signal.aborted) { void logger.error(LOG_MODULE, error, { action: "wait for the share's tab lease", shareId: invite.shareId }); } },
    );
  }

  /**
   * Another tab took the lease: the mirror already stopped writing, so the connection closes and this tab observes.
   * INVARIANT: closing still flushes this tab's pending updates to the share's state; appends only add, so the new owner loses none.
   */
  private async lost(): Promise<void> {
    void this.options.logger.log("INFO", LOG_MODULE, "Another tab took the shared project over", { shareId: this.options.invite.shareId });
    this.lease = undefined;
    await this.disconnect();
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
    await connection.close().catch((error: unknown) =>
      this.options.logger.error(LOG_MODULE, error, { action: "close share connection", shareId: this.options.invite.shareId }));
  }
}
