// Keeps an owned folder lease alive: renews it, detects a foreign owner and releases it on close.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import type { LibraryFileSystem, ILogger } from "../../ports/index.js";
import { leasePath, readLease, writeLease, type LeaseRecord } from "./leaseFile.js";
import type { LeaseScheduler } from "./mirrorScheduler.js";
import { MirrorOwnershipLost } from "./mirrorLostError.js";

export const LEASE_RENEW_MS = 10_000;
const LOG_MODULE = "collab.ownership";

export interface FolderLease {
  /** Throws MirrorOwnershipLost when another mirror owns the folder; a mirror calls it before each disk write batch. */
  assertOwned(): Promise<void>;
  onLost(listener: (error: MirrorOwnershipLost) => void): void;
  /** Stops renewing and deletes the lease file if it is still ours. */
  release(): Promise<void>;
}

export interface HeldLeaseOptions {
  fs: LibraryFileSystem;
  folder: string;
  logger: ILogger;
  scheduler: LeaseScheduler;
}

export class HeldFolderLease implements FolderLease {
  private readonly listeners: Array<(error: MirrorOwnershipLost) => void> = [];
  private lost: MirrorOwnershipLost | undefined;
  private released = false;
  // INVARIANT: renewals and release run one at a time, so a renewal never rewrites a lease that release just deleted.
  private queue: Promise<void> = Promise.resolve();
  private readonly stopRenewing: () => void;

  constructor(private readonly options: HeldLeaseOptions, private readonly record: LeaseRecord) {
    this.stopRenewing = options.scheduler.every(LEASE_RENEW_MS, () => { this.queue = this.queue.then(() => this.renew()); });
  }

  async assertOwned(): Promise<void> {
    if (this.lost) { throw this.lost; }
    const current = await readLease(this.options.fs, this.options.folder, this.options.logger);
    if (current && current.owner !== this.record.owner) {
      throw await this.markLost(current);
    }
  }

  onLost(listener: (error: MirrorOwnershipLost) => void): void {
    this.listeners.push(listener);
  }

  async release(): Promise<void> {
    this.stopRenewing();
    this.released = true;
    await this.queue;
    if (this.lost) { return; }
    const { fs, folder, logger } = this.options;
    const current = await readLease(fs, folder, logger);
    if (current?.owner !== this.record.owner) { return; }
    await fs.removeTree(leasePath(folder));
    await logger.log("INFO", LOG_MODULE, "Released the mirror lease", { folder });
  }

  private async renew(): Promise<void> {
    if (this.released || this.lost) { return; }
    const { fs, folder, logger, scheduler } = this.options;
    try {
      await this.assertOwned();
      await writeLease(fs, folder, { ...this.record, renewedAt: scheduler.now() });
    } catch (error) {
      if (error instanceof MirrorOwnershipLost) { return; }
      // A failed renewal is retried at the next period; the lease stays valid for its ttl meanwhile.
      await logger.error(LOG_MODULE, error, { folder, action: "renew mirror lease" });
    }
  }

  private async markLost(holder: LeaseRecord): Promise<MirrorOwnershipLost> {
    if (this.lost) { return this.lost; }
    const error = new MirrorOwnershipLost(this.options.folder, { app: holder.app, renewedAt: holder.renewedAt });
    this.lost = error;
    this.stopRenewing();
    await this.options.logger.log("WARN", LOG_MODULE, "Lost the mirror lease to another mirror", {
      folder: this.options.folder, holder: holder.app, renewedAt: holder.renewedAt,
    });
    for (const listener of this.listeners) { listener(error); }
    return error;
  }
}
