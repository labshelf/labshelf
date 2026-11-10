// The browser's Remote access: the Account tab's Remote access over the core access and the flag in extension storage, the Mirror run
// and the pull of the edits made on /open/ on this library, one job at a time, and the deck export the share links and the Mirror share.
import {
  applyMirrorEdits, bindMirrorBucket, createAccessTokenReader, createAccountRemote, createDirectoryClient, createMirrorRelay, createMirrorRunner, createRemoteAccess,
  exportDeckFromFiles, parseMirrorState, posixPathOps, readCloudflareEmail, selectMirrorFiles, serializeMirrorState, unbindMirrorBucket,
  type AccountRemote, type DeckFileIo, type ILogger, type LibraryFileSystem,
  type MirrorEditFiles, type MirrorPaper, type MirrorRelay, type MirrorSelectionDeps, type MirrorStateStore, type MirrorStorage,
  type PaperRecord, type RelayAccount, type RemoteAccess, type RemoteAccessResult, type ShareHost,
} from "@labshelf/core";
import { bx } from "../platform";
import { createBackgroundRelayDeps } from "../relay";
import { createBrowserDeviceIdentity, readCurrentLibraryId } from "../storage";

/** The part of `bx.storage.local` the Mirror's hash table needs. */
export interface MirrorStateArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const mirrorStateName = (libraryId: string): string => `labshelf:remote-mirror:${libraryId}`;

/** Keeps the Mirror's hash table of this browser in extension storage, one entry per library; `libraryId` is asked on every call, so the store follows the library the page serves. */
export function createBrowserMirrorStateStore(storage: MirrorStateArea, libraryId: () => Promise<string>): MirrorStateStore {
  return {
    read: async () => {
      const key = mirrorStateName(await libraryId());
      const stored = (await storage.get(key))[key];
      // A value that is not a valid table reads as no table, so the next run starts the Mirror over.
      return typeof stored === "string" ? parseMirrorState(stored) : undefined;
    },
    write: async (state) => { await storage.set({ [mirrorStateName(await libraryId())]: serializeMirrorState(state) }); },
    clear: async () => { await storage.remove(mirrorStateName(await libraryId())); },
  };
}

const PAPERS_PREFIX = "papers/";
const MIRRORED_ROOTS = ["papers", "projects", "spaces"];
const HOME_FILE = "home.json";

const remoteFlagName = (libraryId: string): string => `labshelf:remote-access:${libraryId}`;

const storageArea = {
  get: (key: string) => bx.storage.local.get(key),
  set: (items: Record<string, unknown>) => bx.storage.local.set(items),
  remove: (key: string) => bx.storage.local.remove(key),
};

/** Joins `relative` to `folder`, resolving `.` and `..` segments; a leading slash is taken as the library root. */
function resolveInFolder(folder: string, relative: string): string {
  const segments = relative.startsWith("/") ? [] : folder.split("/").filter((segment) => segment !== "");
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop(); else segments.push(segment);
  }
  return segments.join("/");
}

/** The deck export read over the page's library files: a missing file reads as undefined and nothing here throws. */
export function createDeckExporter(fs: Pick<LibraryFileSystem, "stat" | "readFile">): (deckPath: string) => Promise<{ source: string; html: string; name: string }> {
  const io: DeckFileIo = {
    read: async (path) => {
      try {
        const stat = await fs.stat(path);
        return stat?.isFile ? await fs.readFile(path) : undefined;
      } catch {
        return undefined;
      }
    },
    dirname: (path) => posixPathOps.dirname(path),
    basename: (path) => path.slice(path.lastIndexOf("/") + 1),
    resolve: resolveInFolder,
  };
  return (deckPath) => exportDeckFromFiles(deckPath, io);
}

/** The library files the edits made on /open/ reach, over the page's (atomic) library file system. */
export function createPageEditFiles(fs: Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile" | "ensureDir" | "deleteFile">): MirrorEditFiles {
  return {
    readBytes: async (path) => ((await fs.stat(path))?.isFile ? fs.readFile(path) : undefined),
    writeBytes: async (path, bytes) => {
      const parent = posixPathOps.dirname(path);
      if (parent !== "." && parent !== "") await fs.ensureDir(parent);
      await fs.writeFile(path, bytes);
    },
    remove: async (path) => {
      if ((await fs.stat(path))?.isFile) await fs.deleteFile(path);
    },
  };
}

/** Every file path below `dir`, root-relative and POSIX; a folder that does not exist lists nothing. */
async function listFilesUnder(fs: Pick<LibraryFileSystem, "listDir" | "stat">, dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.listDir(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of names) {
    // Hidden entries are never mirrored, so they are not walked.
    if (name.startsWith(".")) continue;
    const path = `${dir}/${name}`;
    const stat = await fs.stat(path);
    if (stat?.isFile) files.push(path);
    else if (stat?.isDirectory) files.push(...(await listFilesUnder(fs, path)));
  }
  return files;
}

function mirrorPaper(record: PaperRecord): MirrorPaper {
  const parent = posixPathOps.dirname(record.path);
  const folder = parent.startsWith(PAPERS_PREFIX) ? parent.slice(PAPERS_PREFIX.length) : parent === "papers" || parent === "." ? "" : parent;
  return { id: record.id, folder, trashed: record.trashedAt !== undefined, record };
}

export interface PageRemoteAccess {
  /** The Remote access the Account tab shows. */
  remote(): AccountRemote | undefined;
  /** Runs the Mirror once when Remote access is on and Cloudflare is connected; otherwise nothing. Never rejects. */
  run(): Promise<void>;
  /** Applies the edits made on /open/ when Remote access is on, in the same queue as the runs; a run already applies them. Never rejects. */
  pull(): Promise<void>;
}

export interface PageRemoteAccessDeps {
  relayAccounts: { get(): Promise<RelayAccount | undefined> };
  sharing: Pick<ShareHost, "setInvitationsEnabled">;
  papers(): PaperRecord[] | Promise<PaperRecord[]>;
  fs: LibraryFileSystem;
  log: ILogger;
}

const readFlag = async (): Promise<boolean> => {
  const key = remoteFlagName(await readCurrentLibraryId());
  return (await bx.storage.local.get(key))[key] === true;
};
const writeFlag = async (on: boolean): Promise<void> => {
  await bx.storage.local.set({ [remoteFlagName(await readCurrentLibraryId())]: on });
};

// PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome.
const fetchNow: typeof fetch = (input, init) => globalThis.fetch(input, init);

interface Built { access: RemoteAccess; runner: ReturnType<typeof createMirrorRunner>; relay: MirrorRelay; state: MirrorStateStore; files: MirrorEditFiles }

/** The core access and the Mirror runner for one Cloudflare account, over this library's files; each run's storage goes to `record`. */
async function buildMirror(deps: PageRemoteAccessDeps, account: RelayAccount, record: (storage: MirrorStorage) => void): Promise<Built> {
  const { sharing, fs, log } = deps;
  const exportDeck = createDeckExporter(fs);
  const state = createBrowserMirrorStateStore(storageArea, readCurrentLibraryId);
  const libraryId = await readCurrentLibraryId();
  const accessToken = createAccessTokenReader(createBackgroundRelayDeps(log), account.credential);
  const relay = createMirrorRelay({
    relayUrl: account.relayUrl, ownerSecret: account.ownerSecret, deviceId: await createBrowserDeviceIdentity(libraryId, log).id(), fetch: fetchNow,
  });
  const selection = async (): Promise<MirrorSelectionDeps> => ({
    papers: (await deps.papers()).map(mirrorPaper),
    listFiles: async () => {
      const files = (await Promise.all(MIRRORED_ROOTS.map((root) => listFilesUnder(fs, root)))).flat();
      if ((await fs.stat(HOME_FILE))?.isFile) files.push(HOME_FILE);
      return files;
    },
    readText: (path) => fs.readText(path),
    readBytes: (path) => fs.readFile(path),
    fileSize: async (path) => (await fs.stat(path))?.size ?? 0,
    exportDeck,
  });
  const files = createPageEditFiles(fs);
  const inner = createMirrorRunner({ relay, state, files, select: async (options) => selectMirrorFiles(await selection(), options) });
  const runner: Built["runner"] = {
    run: async () => {
      const result = await inner.run();
      if (result.storage) record(result.storage);
      return result;
    },
  };
  const directory = createDirectoryClient({ accessToken, fetch: fetchNow });
  const access = createRemoteAccess({
    readEmail: async () => readCloudflareEmail(await accessToken()),
    relay, runner, state, selection,
    directory: { self: () => directory.self(), register: async () => { await sharing.setInvitationsEnabled(true); } },
  });
  return { access, runner, relay, state, files };
}

/**
 * One job at a time: a request during a job asks for one more after it. A sync waiting replaces a waiting pull, since every
 * sync applies the edits first.
 */
export function serializeRuns(jobs: { run(): Promise<void>; pull(): Promise<void> }): { run(): Promise<void>; pull(): Promise<void> } {
  let running: Promise<void> | undefined;
  const waiting = { run: false, pull: false };
  const request = (kind: "run" | "pull"): Promise<void> => {
    waiting[kind] = true;
    running ??= (async () => {
      try {
        while (waiting.run || waiting.pull) {
          if (waiting.run) {
            waiting.run = false;
            waiting.pull = false;
            await jobs.run();
          } else {
            waiting.pull = false;
            await jobs.pull();
          }
        }
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
  return { run: () => request("run"), pull: () => request("pull") };
}

const NO_RELAY: RemoteAccessResult = { ok: false, reason: "no_relay", message: "Connect Cloudflare first." };

export function createPageRemoteAccess(deps: PageRemoteAccessDeps): PageRemoteAccess {
  const { relayAccounts, log } = deps;
  // The last sync's storage, kept for the library it ran on.
  let last: { libraryId: string; storage: MirrorStorage } | undefined;

  async function build(): Promise<Built | undefined> {
    const account = await relayAccounts.get();
    if (!account) return undefined;
    const libraryId = await readCurrentLibraryId();
    return buildMirror(deps, account, (storage) => { last = { libraryId, storage }; });
  }

  // Every call builds over the account connected at that time; without one there is nothing to turn off.
  const act = (use: (access: RemoteAccess) => Promise<RemoteAccessResult>, none = NO_RELAY) => async (): Promise<RemoteAccessResult> => {
    const built = await build();
    return built ? use(built.access) : none;
  };
  const access: RemoteAccess = {
    turnOn: act((a) => a.turnOn()),
    turnOff: act((a) => a.turnOff(), { ok: true }),
    status: async () => {
      const built = await build();
      if (!built) throw new Error("Connect Cloudflare first.");
      return built.access.status();
    },
    setIncludePdfs: (on) => act((a) => a.setIncludePdfs(on))(),
    setLimit: (bytes) => act((a) => a.setLimit(bytes))(),
    moveStore: (store) => act((a) => a.moveStore(store))(),
    estimatePaperPdfs: async () => {
      const built = await build();
      return built ? built.access.estimatePaperPdfs() : { bytes: 0, files: 0 };
    },
  };
  const remote = createAccountRemote({
    flag: { read: readFlag, write: writeFlag },
    access,
    bucket: {
      bind: () => bindMirrorBucket(createBackgroundRelayDeps(log)),
      unbind: () => unbindMirrorBucket(createBackgroundRelayDeps(log)),
    },
    lastStorage: async () => {
      const libraryId = await readCurrentLibraryId();
      return last?.libraryId === libraryId ? last.storage : undefined;
    },
  });

  const guarded = (action: string, job: (built: Built) => Promise<unknown>) => async (): Promise<void> => {
    try {
      if (!(await readFlag())) return;
      const built = await build();
      if (!built) return;
      await job(built);
    } catch (error) {
      await log.error("remoteLibrary", error, { action });
    }
  };

  const queue = serializeRuns({
    run: guarded("mirror run", (built) => built.runner.run()),
    pull: guarded("mirror edits", (built) => applyMirrorEdits({ relay: built.relay, files: built.files, state: built.state })),
  });
  return { remote: () => remote, run: queue.run, pull: queue.pull };
}
