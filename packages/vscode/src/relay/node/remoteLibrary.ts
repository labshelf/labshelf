// The desktop's Remote access: the Account's Remote access over the core access, the stored flag and the share Worker's bucket, and the
// trigger that runs the Mirror after changes and pulls the edits made on /open/ every minute, one job at a time.
import { promises as nodeFs } from "node:fs";
import * as path from "node:path";

import {
  applyMirrorEdits, createAccountRemote, createDirectoryClient, createMirrorRelay, createMirrorRunner, createRemoteAccess, exportDeckFromFiles,
  readCloudflareEmail, selectMirrorFiles,
  type AccountRemote, type DeckFileIo, type ILogger, type LibraryFileSystem,
  type MirrorEditFiles, type MirrorPaper, type MirrorRelay, type MirrorSelectionDeps, type MirrorStateStore,
  type MirrorStorage, type RelayAccountStore, type RemoteAccess, type RemoteAccessResult,
} from "@labshelf/core";
import { createDeviceIdentity, createDeviceLocalLayout, createFileMirrorStateStore, deriveLibraryKey, readOptionalFile, writeFileAtomic } from "@labshelf/core/node";
import type { ActiveServices } from "../../command/index.js";

/** The delay after the last external-change batch before the Mirror runs. */
const MIRROR_DELAY_MS = 30_000;
/** How often the edits made on /open/ are pulled while Remote access is on. */
const EDITS_PULL_MS = 60_000;

/** Reads the Cloudflare email once per relay for the session; a failed read answers undefined and is asked again next time. */
export function createCloudflareEmailCache(read: (relayUrl: string) => Promise<string | undefined>): (relayUrl: string) => Promise<string | undefined> {
  const cache = new Map<string, Promise<string | undefined>>();
  return (relayUrl) => {
    let found = cache.get(relayUrl);
    if (!found) {
      // The email is never logged, nor the reason a read failed.
      found = read(relayUrl).catch(() => { cache.delete(relayUrl); return undefined; });
      cache.set(relayUrl, found);
    }
    return found;
  };
}

type MirrorTriggerDeps = {
  isOn(): boolean;
  run(): Promise<unknown>;
  pull?: () => Promise<unknown>;
  delayMs?: number;
  pullMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

type TimerOps = { setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (handle: unknown) => void };

/** The one-job-at-a-time queue: a delayed run after the last change, and a change during a job schedules one more run after it. */
function createRunQueue(deps: Pick<MirrorTriggerDeps, "isOn" | "run">, delayMs: number, timers: TimerOps): {
  changed(): void; runNow(): Promise<void>; runPull(pull: () => Promise<unknown>): Promise<void>; isDisposed(): boolean; dispose(): void;
} {
  let timer: unknown;
  let running = false;
  let again = false;
  let disposed = false;

  const stopTimer = (): void => { if (timer !== undefined) { timers.clearTimer(timer); timer = undefined; } };

  const runJob = async (job: () => Promise<unknown>): Promise<void> => {
    running = true;
    try {
      await job();
    } catch {
      // A failed run is the runner's to report; the next change or pull tries again.
    } finally {
      running = false;
    }
    if (again && !disposed) {
      again = false;
      schedule();
    }
  };

  const runNow = async (): Promise<void> => {
    if (disposed || !deps.isOn()) { return; }
    if (running) { again = true; return; }
    await runJob(deps.run);
  };

  const schedule = (): void => {
    stopTimer();
    timer = timers.setTimer(() => { timer = undefined; void runNow(); }, delayMs);
  };

  return {
    changed: () => {
      if (disposed) { return; }
      if (running) { again = true; }
      schedule();
    },
    runNow,
    runPull: async (pull) => {
      if (!disposed && !running && deps.isOn()) { await runJob(pull); }
    },
    isDisposed: () => disposed,
    dispose: () => { disposed = true; stopTimer(); },
  };
}

/**
 * Runs the Mirror on start and a delay after the last change, never twice at once; a change during a run schedules one more run after it.
 * With `pull`, it also pulls the edits made on /open/ every `pullMs` while on, in the same queue: a pull due during a run is skipped,
 * since every run applies the edits first.
 */
export function createMirrorTrigger(deps: MirrorTriggerDeps): { changed(): void; start(): void; dispose(): void } {
  const pullMs = deps.pullMs ?? EDITS_PULL_MS;
  const timers: TimerOps = {
    setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: deps.clearTimer ?? ((handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); }),
  };
  const queue = createRunQueue(deps, deps.delayMs ?? MIRROR_DELAY_MS, timers);
  let pullTimer: unknown;

  const schedulePull = (): void => {
    const pull = deps.pull;
    if (!pull || queue.isDisposed()) { return; }
    pullTimer = timers.setTimer(() => {
      pullTimer = undefined;
      void (async () => {
        await queue.runPull(pull);
        schedulePull();
      })();
    }, pullMs);
  };

  return {
    changed: queue.changed,
    start: () => {
      if (queue.isDisposed()) { return; }
      if (pullTimer === undefined) { schedulePull(); }
      void queue.runNow();
    },
    dispose: () => {
      queue.dispose();
      if (pullTimer !== undefined) { timers.clearTimer(pullTimer); pullTimer = undefined; }
    },
  };
}

/** Deck file reads over Node's file system; any read error answers undefined, as the export treats a missing asset. */
export function createNodeDeckFileIo(): DeckFileIo {
  return {
    read: async (file) => {
      try {
        return await nodeFs.readFile(file);
      } catch {
        return undefined;
      }
    },
    dirname: (file) => path.dirname(file),
    basename: (file) => path.basename(file),
    resolve: (folder, relative) => path.resolve(folder, ...relative.split("/")),
  };
}

/** The library files the edits made on /open/ reach, by library-relative path, over the library's (atomic) file system. */
function createLibraryEditFiles(fs: Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile" | "ensureDir" | "deleteFile">, absolute: (relative: string) => string): MirrorEditFiles {
  return {
    readBytes: async (file) => ((await fs.stat(absolute(file)))?.isFile ? fs.readFile(absolute(file)) : undefined),
    writeBytes: async (file, bytes) => {
      const target = absolute(file);
      await fs.ensureDir(path.dirname(target));
      await fs.writeFile(target, bytes);
    },
    remove: async (file) => {
      if ((await fs.stat(absolute(file)))?.isFile) { await fs.deleteFile(absolute(file)); }
    },
  };
}

/** Folders the Mirror never reads, so the walk skips what the selection would drop anyway. */
const SKIPPED_FOLDERS = new Set(["build", "_output"]);

/** Every file under the library's papers/, projects/ and spaces/ folders, and home.json when present, as root-relative POSIX paths. */
async function listLibraryFiles(root: string, fs: ActiveServices["fileSystem"]): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    const folder = path.join(root, ...relative.split("/"));
    for (const name of await fs.listDir(folder)) {
      if (name.startsWith(".") || SKIPPED_FOLDERS.has(name)) { continue; }
      const child = `${relative}/${name}`;
      const stat = await fs.stat(path.join(folder, name));
      if (stat?.isDirectory) { await walk(child); } else if (stat?.isFile) { found.push(child); }
    }
  };
  await walk("papers");
  await walk("projects");
  await walk("spaces");
  if ((await fs.stat(path.join(root, "home.json")))?.isFile) { found.push("home.json"); }
  return found;
}

export interface DesktopRemoteDeps {
  /** The extension's global state, which keeps each library's on flag. */
  state: { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> };
  libraryRoot(): string | undefined;
  services(): ActiveServices | null;
  relay: RelayAccountStore;
  /** The Cloudflare access token of the stored account; rejects without one. */
  accessToken(): Promise<string>;
  /** The directory registration: turns Receive invitations by email on. */
  enableInvitations(): Promise<void>;
  /** Binds or unbinds the R2 bucket on the share Worker. */
  bucket: { bind(): Promise<void>; unbind(): Promise<void> };
  logger: ILogger;
}

const NO_LIBRARY: RemoteAccessResult = { ok: false, reason: "failed", message: "Open a LabShelf library first." };
const NO_RELAY: RemoteAccessResult = { ok: false, reason: "no_relay", message: "Connect Cloudflare first." };

interface Built {
  access: RemoteAccess;
  runner: ReturnType<typeof createMirrorRunner>;
  relay: MirrorRelay;
  state: MirrorStateStore;
  files: MirrorEditFiles;
}

const flagKey = (root: string): string => `labshelf.remoteAccess.${deriveLibraryKey(root)}`;
const isBuilt = (built: Built | RemoteAccessResult): built is Built => "runner" in built;

/** The access and the runner of the library and relay open now; the reason when there is none. Each run's storage goes to `record`. */
async function buildRemote(deps: DesktopRemoteDeps, record: (root: string, storage: MirrorStorage) => void): Promise<Built | RemoteAccessResult> {
  const root = deps.libraryRoot();
  const services = deps.services();
  if (!root || !services) { return NO_LIBRARY; }
  const account = await deps.relay.get();
  if (!account) { return NO_RELAY; }
  const layout = createDeviceLocalLayout(root);
  const deviceId = await createDeviceIdentity(layout, deps.logger).id();
  const relay = createMirrorRelay({ relayUrl: account.relayUrl, ownerSecret: account.ownerSecret, deviceId, fetch: globalThis.fetch });
  const state = createFileMirrorStateStore(layout.mirrorStatePath, {
    readText: readOptionalFile,
    writeText: (file, text) => writeFileAtomic(file, text),
    remove: (file) => nodeFs.rm(file, { force: true }),
  });
  const io = createNodeDeckFileIo();
  const fs = services.fileSystem;
  const absolute = (relative: string): string => path.join(root, ...relative.split("/"));
  const selection: MirrorSelectionDeps = {
    papers: [...services.library.snapshot.papers.values()].map((entry): MirrorPaper => ({
      id: entry.record.id, folder: entry.collection, trashed: entry.record.trashedAt !== undefined, record: entry.record,
    })),
    listFiles: () => listLibraryFiles(root, fs),
    readText: (file) => fs.readText(absolute(file)),
    readBytes: (file) => fs.readFile(absolute(file)),
    fileSize: async (file) => (await fs.stat(absolute(file)))?.size ?? 0,
    exportDeck: (deckPath) => exportDeckFromFiles(absolute(deckPath), io),
  };
  const files = createLibraryEditFiles(fs, absolute);
  const inner = createMirrorRunner({ relay, state, files, select: (options) => selectMirrorFiles(selection, options) });
  const runner: Built["runner"] = {
    run: async () => {
      const result = await inner.run();
      if (result.storage) { record(root, result.storage); }
      return result;
    },
  };
  const directory = createDirectoryClient({ accessToken: deps.accessToken });
  const access = createRemoteAccess({
    readEmail: async () => readCloudflareEmail(await deps.accessToken()),
    relay, runner, state,
    selection: async () => selection,
    directory: { self: () => directory.self(), register: () => deps.enableInvitations() },
  });
  return { access, runner, relay, state, files };
}

/** An access whose every call builds over the library and relay open at that time; without them the actions answer the reason. */
function createLazyAccess(build: () => Promise<Built | RemoteAccessResult>): RemoteAccess {
  const act = (use: (access: RemoteAccess) => Promise<RemoteAccessResult>) => async (): Promise<RemoteAccessResult> => {
    const built = await build();
    return isBuilt(built) ? use(built.access) : built;
  };
  const read = async <T>(use: (access: RemoteAccess) => Promise<T>): Promise<T> => {
    const built = await build();
    if (!isBuilt(built)) { throw new Error(built.ok ? "Remote access is not available." : built.message); }
    return use(built.access);
  };
  return {
    turnOn: act((access) => access.turnOn()),
    turnOff: act((access) => access.turnOff()),
    status: () => read((access) => access.status()),
    setIncludePdfs: (on) => act((access) => access.setIncludePdfs(on))(),
    setLimit: (limit) => act((access) => access.setLimit(limit))(),
    moveStore: (store) => act((access) => access.moveStore(store))(),
    estimatePaperPdfs: async () => {
      const built = await build();
      return isBuilt(built) ? built.access.estimatePaperPdfs() : { bytes: 0, files: 0 };
    },
  };
}

/** The Account tab's Remote access and the Mirror trigger, built per call over the library and relay open at that time. */
export function createDesktopRemoteLibrary(deps: DesktopRemoteDeps): { remoteAccess(): AccountRemote | undefined; trigger: ReturnType<typeof createMirrorTrigger> } {
  // The last sync's storage, kept for the library it ran on.
  let last: { root: string; storage: MirrorStorage } | undefined;
  const build = (): Promise<Built | RemoteAccessResult> => buildRemote(deps, (root, storage) => { last = { root, storage }; });
  const isOn = (): boolean => {
    const root = deps.libraryRoot();
    return root !== undefined && deps.state.get<boolean>(flagKey(root)) === true;
  };
  const trigger = createMirrorTrigger({
    isOn,
    run: async () => {
      // No account or no library is a silent skip.
      const built = await build();
      if (isBuilt(built)) { await built.runner.run(); }
    },
    pull: async () => {
      const built = await build();
      if (isBuilt(built)) { await applyMirrorEdits({ relay: built.relay, files: built.files, state: built.state }); }
    },
  });

  return {
    trigger,
    remoteAccess: () => {
      const root = deps.libraryRoot();
      if (!root) { return undefined; }
      const key = flagKey(root);
      return createAccountRemote({
        flag: { read: () => deps.state.get<boolean>(key) === true, write: async (on) => { await deps.state.update(key, on); } },
        access: createLazyAccess(build),
        bucket: deps.bucket,
        lastStorage: () => (last?.root === root ? last.storage : undefined),
      });
    },
  };
}
