// Keeps a project folder's mirror lease: the lease file, its clock, acquiring it, renewing it and detecting a foreign owner.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import { sleep } from "../../async/index.js";
import { parseJsonObject } from "../../json/index.js";
import type { IFileSystem, ILogger, LibraryFileSystem } from "../../ports/index.js";

const LOG_MODULE = "collab.ownership";
const LEASE_TTL_MS = 30_000;
const LEASE_DIR = ".labshelf";
const LEASE_NAME = "mirror-lease.json";

export type MirrorApp = "vscode" | "browser";

export interface LeaseHolder {
  app: MirrorApp;
  renewedAt: number;
}

interface LeaseFileContent extends LeaseHolder {
  owner: string;
  ttlMs: number;
}

function deriveLeasePath(folder: string): string {
  return `${folder.replace(/\/+$/, "")}/${LEASE_DIR}/${LEASE_NAME}`;
}

function parseLease(text: string): LeaseFileContent | undefined {
  const root = parseJsonObject(text);
  if (!root) { return undefined; }
  const { owner, app, renewedAt, ttlMs } = root;
  if (typeof owner !== "string" || owner === "" || (app !== "vscode" && app !== "browser")) { return undefined; }
  if (typeof renewedAt !== "number" || !Number.isFinite(renewedAt)) { return undefined; }
  if (typeof ttlMs !== "number" || !(ttlMs > 0)) { return undefined; }
  return { owner, app, renewedAt, ttlMs };
}

/** The lease in the folder; a missing file is undefined, and a malformed one is undefined with a WARN because it counts as expired. */
async function readLease(fs: IFileSystem, folder: string, logger: ILogger): Promise<LeaseFileContent | undefined> {
  const file = deriveLeasePath(folder);
  if (!(await fs.exists(file))) { return undefined; }
  const lease = parseLease(await fs.readText(file));
  if (!lease) { await logger.log("WARN", LOG_MODULE, "Treated a malformed mirror lease as expired", { file }); }
  return lease;
}

async function writeLease(fs: IFileSystem, folder: string, lease: LeaseFileContent): Promise<void> {
  await fs.ensureDir(`${folder.replace(/\/+$/, "")}/${LEASE_DIR}`);
  await fs.writeText(deriveLeasePath(folder), JSON.stringify(lease));
}

function isLive(lease: LeaseFileContent, now: number): boolean {
  return lease.renewedAt + lease.ttlMs > now;
}

export class MirrorLostError extends Error {
  constructor(readonly folder: string, readonly holder: LeaseHolder) {
    super(`The mirror of ${folder} is owned by ${holder.app} (renewed at ${new Date(holder.renewedAt).toISOString()})`);
    this.name = "MirrorLostError";
  }
}

export interface LeaseScheduler {
  now(): number;
  delay(ms: number): Promise<void>;
  /** Runs the task every `ms` until the returned stop function is called. */
  every(ms: number, task: () => void): () => void;
}

export const systemLeaseScheduler: LeaseScheduler = {
  now: () => Date.now(),
  delay: (ms) => sleep(ms),
  every: (ms, task) => {
    const handle = setInterval(task, ms);
    return () => clearInterval(handle);
  },
};

const LEASE_RENEW_MS = 10_000;

export interface FolderLease {
  /** Throws MirrorLostError when another mirror owns the folder; a mirror calls it before each disk write batch. */
  assertOwned(): Promise<void>;
  onLost(listener: (error: MirrorLostError) => void): void;
  /** Stops renewing and deletes the lease file if it is still ours. */
  release(): Promise<void>;
}

interface HeldLeaseOptions {
  fs: LibraryFileSystem;
  folder: string;
  logger: ILogger;
  scheduler: LeaseScheduler;
}

class HeldFolderLease implements FolderLease {
  private readonly listeners: Array<(error: MirrorLostError) => void> = [];
  private lost: MirrorLostError | undefined;
  private released = false;
  // INVARIANT: renewals and release run one at a time, so a renewal never rewrites a lease that release just deleted.
  private queue: Promise<void> = Promise.resolve();
  private readonly stopRenewing: () => void;

  constructor(private readonly options: HeldLeaseOptions, private readonly record: LeaseFileContent) {
    this.stopRenewing = options.scheduler.every(LEASE_RENEW_MS, () => { this.queue = this.queue.then(() => this.renew()); });
  }

  async assertOwned(): Promise<void> {
    if (this.lost) { throw this.lost; }
    const current = await readLease(this.options.fs, this.options.folder, this.options.logger);
    if (current && current.owner !== this.record.owner) {
      throw await this.markLost(current);
    }
  }

  onLost(listener: (error: MirrorLostError) => void): void {
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
    await fs.removeTree(deriveLeasePath(folder));
    await logger.log("INFO", LOG_MODULE, "Released the mirror lease", { folder });
  }

  private async renew(): Promise<void> {
    if (this.released || this.lost) { return; }
    const { fs, folder, logger, scheduler } = this.options;
    try {
      await this.assertOwned();
      await writeLease(fs, folder, { ...this.record, renewedAt: scheduler.now() });
    } catch (error) {
      if (error instanceof MirrorLostError) { return; }
      // A failed renewal is retried at the next period; the lease stays valid for its ttl meanwhile.
      await logger.error(LOG_MODULE, error, { folder, action: "renew mirror lease" });
    }
  }

  private async markLost(holder: LeaseFileContent): Promise<MirrorLostError> {
    if (this.lost) { return this.lost; }
    const error = new MirrorLostError(this.options.folder, { app: holder.app, renewedAt: holder.renewedAt });
    this.lost = error;
    this.stopRenewing();
    await this.options.logger.log("WARN", LOG_MODULE, "Lost the mirror lease to another mirror", {
      folder: this.options.folder, holder: holder.app, renewedAt: holder.renewedAt,
    });
    for (const listener of this.listeners) { listener(error); }
    return error;
  }
}

const LEASE_CONFIRM_MS = 1_500;

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

function holderOf(lease: LeaseFileContent): LeaseHolder {
  return { app: lease.app, renewedAt: lease.renewedAt };
}

export async function openFolderLease(options: AcquireFolderLeaseOptions): Promise<FolderLeaseResult> {
  const { fs, folder, app, logger, takeOver = false } = options;
  const scheduler = options.scheduler ?? systemLeaseScheduler;
  const current = await readLease(fs, folder, logger);
  if (current && !takeOver && isLive(current, scheduler.now())) {
    return { kind: "busy", holder: holderOf(current) };
  }
  const record: LeaseFileContent = { owner: crypto.randomUUID(), app, renewedAt: scheduler.now(), ttlMs: LEASE_TTL_MS };
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
