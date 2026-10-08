/** One sync run, stateless: takes the lock, names Drive folders from titles, runs the engine and records the run. */
import { SYNC_PROVIDER_ID } from "../../library/index.js";
import type { ILogger } from "../../ports/index.js";
import type { RemoteProvider } from "../provider/index.js";
import {
  buildLibraryFolderNames,
  summarizeSyncResult,
  SyncEngine,
  SyncLock,
  SyncManifest,
  writeSyncRunRecord,
  type SyncLockInfo,
  type SyncLockOwner,
  type SyncResult,
  type SyncRunRecord,
} from "../core/index.js";
import type { SyncTarget } from "./types.js";

export interface SyncRunInput {
  target: SyncTarget;
  owner: SyncLockOwner;
  createProvider(): RemoteProvider;
  listTitles?(): Promise<Iterable<readonly [id: string, title: string]>>;
  logger: ILogger;
  /** Log source, e.g. "terminal/sync". */
  source: string;
  clock: () => Date;
}

export type SyncRunAttempt =
  | { ran: true; result: SyncResult; record: SyncRunRecord }
  | { ran: false; holder: SyncLockInfo | undefined };

/**
 * Runs one sync of the target, unless another app holds its lock.
 * @returns the result and the run record, or the lock holder
 */
export async function runSyncOnce(input: SyncRunInput): Promise<SyncRunAttempt> {
  const attempt = await withSyncLock(input, () => runEngine(input));
  if (!attempt.ran) { return attempt; }
  const record = summarizeSyncResult(attempt.value, input.owner.app, input.owner.host);
  await recordRun(input, record);
  return { ran: true, result: attempt.value, record };
}

async function withSyncLock<T>(
  input: SyncRunInput,
  task: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false; holder: SyncLockInfo | undefined }> {
  const { lock } = input.target;
  if (!lock) { return { ran: true, value: await task() }; }
  const syncLock = new SyncLock(lock.store, lock.path, input.owner, {
    now: input.clock,
    ...(lock.isProcessAlive ? { isProcessAlive: lock.isProcessAlive } : {}),
  });
  return syncLock.runExclusive(task);
}

async function runEngine(input: SyncRunInput): Promise<SyncResult> {
  const { target } = input;
  const folderNames = input.listTitles ? buildLibraryFolderNames(await input.listTitles()) : undefined;
  const manifest = await SyncManifest.load(target.state.fs, target.state.manifestPath, SYNC_PROVIDER_ID);
  const engine = new SyncEngine({
    provider: input.createProvider(),
    fs: target.files,
    manifest,
    roots: target.roots,
    clock: input.clock,
    logger: input.logger,
    ...(folderNames ? { libraryFolderNames: folderNames } : {}),
  });
  return engine.run();
}

// The record only tells other apps when the library last synced; losing it must not fail the sync it describes.
async function recordRun(input: SyncRunInput, record: SyncRunRecord): Promise<void> {
  const path = input.target.state.lastRunPath;
  if (!path) { return; }
  try {
    await writeSyncRunRecord(input.target.state.fs, path, record);
  } catch (error) {
    await input.logger.log("WARN", input.source, "Could not write the sync run record", {
      path, message: error instanceof Error ? error.message : String(error),
    });
  }
}
