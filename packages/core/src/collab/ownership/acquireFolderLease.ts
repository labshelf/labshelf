// Acquires the mirror lease of a project folder, or reports which app holds it.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import type { LibraryFileSystem, ILogger } from "../../ports/index.js";
import { HeldFolderLease, type FolderLease } from "./heldFolderLease.js";
import { isLive, LEASE_TTL_MS, readLease, writeLease, type LeaseHolder, type LeaseRecord, type MirrorApp } from "./leaseFile.js";
import { systemLeaseScheduler, type LeaseScheduler } from "./leaseScheduler.js";

export const LEASE_CONFIRM_MS = 1_500;
const LOG_MODULE = "collab.ownership";

export interface AcquireFolderLeaseOptions {
  fs: LibraryFileSystem;
  folder: string;
  app: MirrorApp;
  logger: ILogger;
  scheduler?: LeaseScheduler;
  /** Writes over an unexpired foreign lease ("Use here"). */
  takeOver?: boolean;
}

export type FolderLeaseResult =
  | { kind: "busy"; holder: LeaseHolder }
  | { kind: "owned"; lease: FolderLease };

function holderOf(lease: LeaseRecord): LeaseHolder {
  return { app: lease.app, renewedAt: lease.renewedAt };
}

export async function acquireFolderLease(options: AcquireFolderLeaseOptions): Promise<FolderLeaseResult> {
  const { fs, folder, app, logger, takeOver = false } = options;
  const scheduler = options.scheduler ?? systemLeaseScheduler;
  const current = await readLease(fs, folder, logger);
  if (current && !takeOver && isLive(current, scheduler.now())) {
    return { kind: "busy", holder: holderOf(current) };
  }
  const record: LeaseRecord = { owner: crypto.randomUUID(), app, renewedAt: scheduler.now(), ttlMs: LEASE_TTL_MS };
  await writeLease(fs, folder, record);
  // TRAP: read-then-write is not atomic on any file port; the confirmation read catches a writer that raced us.
  await scheduler.delay(LEASE_CONFIRM_MS);
  const confirmed = await readLease(fs, folder, logger);
  if (confirmed?.owner !== record.owner) {
    if (confirmed) {
      await logger.log("INFO", LOG_MODULE, "Lost the mirror lease race to another mirror", { folder, holder: confirmed.app });
      return { kind: "busy", holder: holderOf(confirmed) };
    }
    throw new Error(`The mirror lease of ${folder} disappeared or broke while it was being confirmed`);
  }
  await logger.log("INFO", LOG_MODULE, takeOver ? "Took over the mirror lease" : "Acquired the mirror lease", { folder, app });
  return { kind: "owned", lease: new HeldFolderLease({ fs, folder, logger, scheduler }, record) };
}
