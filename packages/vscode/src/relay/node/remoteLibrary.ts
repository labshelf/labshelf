// The desktop's Remote access: the Account switch over the core access and the stored flag, and the debounced trigger of the Mirror run.
import { promises as nodeFs } from "node:fs";
import * as path from "node:path";

import {
  createDirectoryClient, createMirrorRelay, createMirrorRunner, createRemoteAccess, deriveTextSha256Hex, exportDeckFromFiles,
  readCloudflareEmail, selectMirrorFiles,
  type AccountRemote, type DeckFileIo, type ILogger, type MirrorPaper, type RelayAccountStore, type RemoteAccessResult,
} from "@labshelf/core";
import { createDeviceIdentity, createDeviceLocalLayout, createFileMirrorStateStore, deriveLibraryKey, readOptionalFile, writeFileAtomic } from "@labshelf/core/node";
import type { ActiveServices } from "../../command/index.js";

/** The delay after the last external-change batch before the Mirror runs. */
const MIRROR_DELAY_MS = 30_000;

/** The Account tab's switch: `read` answers the stored flag; `set` runs the access and stores the flag only when it succeeded. */
export function createDesktopRemoteAccess(deps: {
  flag: { read(): boolean; write(on: boolean): Promise<void> };
  access: { turnOn(): Promise<RemoteAccessResult>; turnOff(): Promise<RemoteAccessResult> };
}): AccountRemote {
  return {
    read: async () => ({ on: deps.flag.read() }),
    set: async (on) => {
      const result = on ? await deps.access.turnOn() : await deps.access.turnOff();
      if (!result.ok) { return { ok: false, message: result.message }; }
      await deps.flag.write(on);
      return { ok: true };
    },
  };
}

/** Runs the Mirror on start and a delay after the last change, never twice at once; a change during a run schedules one more run after it. */
export function createMirrorTrigger(deps: {
  isOn(): boolean;
  run(): Promise<unknown>;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): { changed(): void; start(): void; dispose(): void } {
  const delayMs = deps.delayMs ?? MIRROR_DELAY_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); });
  let timer: unknown;
  let running = false;
  let again = false;
  let disposed = false;

  const stopTimer = (): void => { if (timer !== undefined) { clearTimer(timer); timer = undefined; } };

  const runNow = async (): Promise<void> => {
    if (disposed || !deps.isOn()) { return; }
    if (running) { again = true; return; }
    running = true;
    try {
      await deps.run();
    } catch {
      // A failed run is the runner's to report; the next change tries again.
    } finally {
      running = false;
    }
    if (again && !disposed) {
      again = false;
      schedule();
    }
  };

  const schedule = (): void => {
    stopTimer();
    timer = setTimer(() => { timer = undefined; void runNow(); }, delayMs);
  };

  return {
    changed: () => {
      if (disposed) { return; }
      if (running) { again = true; }
      schedule();
    },
    start: () => { if (!disposed) { void runNow(); } },
    dispose: () => { disposed = true; stopTimer(); },
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

/** Folders the Mirror never reads, so the walk skips what the selection would drop anyway. */
const SKIPPED_FOLDERS = new Set(["build", "_output"]);

/** Every file under the library's papers/ and projects/ folders as root-relative POSIX paths. */
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
  logger: ILogger;
}

const NO_LIBRARY: RemoteAccessResult = { ok: false, reason: "failed", message: "Open a LabShelf library first." };
const NO_RELAY: RemoteAccessResult = { ok: false, reason: "no_relay", message: "Connect Cloudflare first." };

interface Built { access: ReturnType<typeof createRemoteAccess>; runner: ReturnType<typeof createMirrorRunner> }

const flagKey = (root: string): string => `labshelf.remoteAccess.${deriveLibraryKey(root)}`;
const isBuilt = (built: Built | RemoteAccessResult): built is Built => "runner" in built;

/** The access and the runner of the library and relay open now; the reason when there is none. */
async function buildRemote(deps: DesktopRemoteDeps): Promise<Built | RemoteAccessResult> {
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
  const absolute = (relative: string): string => path.join(root, ...relative.split("/"));
  const runner = createMirrorRunner({
    relay, state, relayUrl: account.relayUrl, hash: deriveTextSha256Hex,
    select: () => selectMirrorFiles({
      papers: [...services.library.snapshot.papers.values()].map((entry): MirrorPaper => ({
        id: entry.record.id, folder: entry.collection, trashed: entry.record.trashedAt !== undefined, record: entry.record,
      })),
      listFiles: () => listLibraryFiles(root, services.fileSystem),
      readText: (file) => services.fileSystem.readText(absolute(file)),
      exportDeck: (deckPath) => exportDeckFromFiles(absolute(deckPath), io),
    }),
  });
  const directory = createDirectoryClient({ accessToken: deps.accessToken });
  const access = createRemoteAccess({
    readEmail: async () => readCloudflareEmail(await deps.accessToken()),
    relay, runner, state,
    directory: { self: () => directory.self(), register: () => deps.enableInvitations() },
  });
  return { access, runner };
}

/** The Account tab's Remote access and the debounced Mirror trigger, built per call over the library and relay open at that time. */
export function createDesktopRemoteLibrary(deps: DesktopRemoteDeps): { remoteAccess(): AccountRemote | undefined; trigger: ReturnType<typeof createMirrorTrigger> } {
  const trigger = createMirrorTrigger({
    isOn: () => {
      const root = deps.libraryRoot();
      return root !== undefined && deps.state.get<boolean>(flagKey(root)) === true;
    },
    run: async () => {
      // No account or no library is a silent skip.
      const built = await buildRemote(deps);
      if (isBuilt(built)) { await built.runner.run(); }
    },
  });

  return {
    trigger,
    remoteAccess: () => {
      const root = deps.libraryRoot();
      if (!root) { return undefined; }
      const key = flagKey(root);
      return createDesktopRemoteAccess({
        flag: { read: () => deps.state.get<boolean>(key) === true, write: async (on) => { await deps.state.update(key, on); } },
        access: {
          turnOn: async () => { const built = await buildRemote(deps); return isBuilt(built) ? built.access.turnOn() : built; },
          turnOff: async () => { const built = await buildRemote(deps); return isBuilt(built) ? built.access.turnOff() : built; },
        },
      });
    },
  };
}
