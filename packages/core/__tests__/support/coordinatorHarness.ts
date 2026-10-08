/** A SyncCoordinator wired to in-memory fakes, with a settable clock and a log capture, for coordinator tests. */
import { SyncCoordinator, type ILogger, type SyncCoordinatorDeps, type SyncTarget } from "../../src/index.js";
import { FakeRemoteProvider, ManualSyncTimers, MemoryFileSystem, MemoryLockStore } from "./syncFakes.js";

export const LOCK_PATH = "/lib/.research/sync/google-drive.lock";
export const LAST_RUN_PATH = "/lib/.research/sync/google-drive.last.json";
export const START = Date.parse("2026-05-16T12:00:00.000Z");

export interface LogLine { level: string; module: string; message: string; context: Record<string, unknown> }

export interface Harness {
  coordinator: SyncCoordinator;
  fs: MemoryFileSystem;
  provider: FakeRemoteProvider;
  lockStore: MemoryLockStore;
  timers: ManualSyncTimers;
  auth: { authenticated: boolean; configured: boolean; isAuthenticated(): boolean; isConfigured(): boolean; load(): Promise<void> };
  target: SyncTarget;
  logs: LogLine[];
  logger: ILogger;
  advance(ms: number): void;
  now(): number;
}

/** @returns a coordinator over fresh fakes; `overrides` replace any dependency */
export function coordinatorHarness(overrides: Partial<SyncCoordinatorDeps> = {}): Harness {
  const fs = new MemoryFileSystem();
  const provider = new FakeRemoteProvider();
  const lockStore = new MemoryLockStore();
  const timers = new ManualSyncTimers();
  const logs: LogLine[] = [];
  const logger: ILogger = {
    log: async (level, module, message, context = {}) => { logs.push({ level, module, message, context }); },
    error: async () => undefined,
  };
  let now = START;
  const auth = {
    authenticated: true,
    configured: true,
    isAuthenticated(): boolean { return this.authenticated; },
    isConfigured(): boolean { return this.configured; },
    async load(): Promise<void> { /* tokens are set by the test */ },
  };
  const target: SyncTarget = {
    files: fs,
    roots: { library: "/lib/papers", appdata: "/lib/.research/papers" },
    state: { fs, manifestPath: "/lib/.research/sync/google-drive.state.json", lastRunPath: LAST_RUN_PATH },
    lock: { store: lockStore, path: LOCK_PATH, isProcessAlive: () => true },
  };
  const coordinator = new SyncCoordinator({
    app: "test", host: "laptop", pid: 1, getTarget: () => target, auth, createProvider: () => provider,
    logger, clock: () => new Date(now), timers, ...overrides,
  });
  return {
    coordinator, fs, provider, lockStore, timers, auth, target, logs, logger,
    advance: (ms) => { now += ms; },
    now: () => now,
  };
}

/** @returns lock file text held by another app on another host, with a fresh heartbeat */
export function foreignLock(heartbeatMs: number): string {
  const at = new Date(heartbeatMs).toISOString();
  return JSON.stringify({ app: "vscode", pid: 42, host: "desktop", token: "theirs", acquiredAt: at, heartbeatAt: at });
}
