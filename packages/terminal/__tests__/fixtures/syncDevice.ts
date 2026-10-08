/** A terminal "device" for sync tests: a temp library, its store, Drive auth with stored tokens, and its coordinator. */
import type { ILogger, LibraryStore, RemoteProvider, SyncCoordinator, SyncOutcome, SyncStatus } from "@labshelf/core";

import { createLibraryStore } from "../../src/library/libraryModel";
import { PaperSearchIndex } from "../../src/library/paperSearchIndex";
import { CliDriveAuth, createTerminalSync } from "../../src/sync/index";
import { FakeRemoteProvider, MemoryTokenStore } from "./fakeRemote";
import { createTempLibrary, type PaperFixture, type TempLibrary } from "./library";

export const SILENT_LOGGER: ILogger = { log: async () => undefined, error: async () => undefined };
export const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" };
export const VALID_TOKENS = () => ({ access_token: "access", refresh_token: "refresh", expiry_ms: Date.now() + 3_600_000 });

export interface Device {
  lib: TempLibrary;
  store: LibraryStore;
  tokens: MemoryTokenStore;
  auth: CliDriveAuth;
  sync: SyncCoordinator;
  factory: jest.Mock<RemoteProvider, []>;
  logs: Array<{ level: string; message: string }>;
  logger: ILogger;
  statuses: SyncStatus[];
}

export interface DeviceOptions {
  papers?: PaperFixture[];
  remote?: FakeRemoteProvider;
  host?: string;
  tokens?: MemoryTokenStore;
  client?: typeof CLIENT | undefined;
  authFetch?: typeof fetch;
  /** Called before the coordinator is built, e.g. to write coordination files. */
  prepare?: (lib: TempLibrary) => Promise<void>;
}

/** @returns an initialised device */
export async function device(options: DeviceOptions = {}): Promise<Device> {
  const lib = await createTempLibrary(options.papers ?? []);
  await options.prepare?.(lib);
  const store = createLibraryStore(lib.paths, SILENT_LOGGER, new PaperSearchIndex());
  await store.reload();
  const tokens = options.tokens ?? new MemoryTokenStore(VALID_TOKENS());
  const noNetwork = (async () => { throw new Error("unexpected network call from the auth layer"); }) as typeof fetch;
  const client = "client" in options ? options.client : CLIENT;
  const auth = new CliDriveAuth(client, tokens, options.authFetch ?? noNetwork);
  const remote = options.remote ?? new FakeRemoteProvider();
  const factory = jest.fn((): RemoteProvider => remote);
  const logs: Array<{ level: string; message: string }> = [];
  const logger: ILogger = { log: async (level, _module, message) => { logs.push({ level, message }); }, error: async () => undefined };
  const sync = createTerminalSync({ paths: lib.paths, auth, store, logger, providerFactory: factory, host: options.host ?? "host-a" });
  const statuses: SyncStatus[] = [];
  sync.onStatus((s) => statuses.push(s));
  await sync.init();
  return { lib, store, tokens, auth, sync, factory, logs, logger, statuses };
}

/** @returns the outcome narrowed to synced; throws otherwise */
export function expectSynced(outcome: SyncOutcome): Extract<SyncOutcome, { kind: "synced" }> {
  if (outcome.kind !== "synced") { throw new Error(`expected a synced outcome, got ${JSON.stringify(outcome)}`); }
  return outcome;
}
