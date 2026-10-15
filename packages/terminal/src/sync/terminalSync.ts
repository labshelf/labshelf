/** Builds the terminal's sync coordinator: the library on disk, the shared lock and run record, titles scanned from disk. */
import * as os from "node:os";

import {
  createGoogleDriveProvider,
  diskSyncTarget,
  libraryChanged,
  ReauthRequiredError,
  SyncCoordinator,
  type ILogger,
  type LibraryStore,
  type RemoteProvider,
  type SyncTimers,
} from "@labshelf/core";
import { isProcessAlive, NodeLibraryFileSystem, NodeLockStore, type PkceLoopbackAuth } from "@labshelf/core/node";

import { scanLibraryOnDisk, type LibraryRoot } from "../library/index.js";

export interface TerminalSyncDeps {
  paths: LibraryRoot;
  auth: PkceLoopbackAuth;
  /** Reloaded after a sync that changed the papers on disk. */
  store?: LibraryStore;
  logger: ILogger;
  /** Injectable for tests; defaults to the Drive provider. */
  providerFactory?: (auth: PkceLoopbackAuth) => RemoteProvider;
  now?: () => Date;
  host?: string;
  timers?: SyncTimers;
}

/** @returns the coordinator that syncs this library from the terminal */
export function createTerminalSync(deps: TerminalSyncDeps): SyncCoordinator {
  const { paths, auth, logger } = deps;
  const localFs = new NodeLibraryFileSystem(paths.layout.tmpDir());
  const target = diskSyncTarget({ files: localFs, layout: paths.layout, toPath: (p) => p, lock: { store: new NodeLockStore(), isProcessAlive } });
  return new SyncCoordinator({
    app: "terminal",
    host: deps.host ?? os.hostname(),
    pid: process.pid,
    getTarget: () => target,
    auth,
    createProvider: () => deps.providerFactory?.(auth) ?? createGoogleDriveProvider(auth),
    // Titles straight from disk, not from a possibly stale view: Drive folder names are derived from them.
    listTitles: async () => (await scanLibraryOnDisk(paths, logger)).papers.map((e) => [e.record.id, e.record.title] as const),
    logger,
    ...(deps.now ? { clock: deps.now } : {}),
    ...(deps.timers ? { timers: deps.timers } : {}),
    isReauthError: (error) => error instanceof ReauthRequiredError,
    onOutcome: async (outcome) => {
      if (outcome.kind === "synced" && libraryChanged(outcome.result)) { await deps.store?.reload(); }
    },
  });
}
