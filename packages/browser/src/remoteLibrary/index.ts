// The browser's Remote access: the Account tab's switch over the core access and the flag in extension storage, the Mirror run
// on this library, and the deck export the share links and the Mirror share.
import {
  createAccessTokenReader, createDirectoryClient, createMirrorRelay, createMirrorRunner, createRemoteAccess, deriveTextSha256Hex,
  exportDeckFromFiles, parseMirrorState, posixPathOps, readCloudflareEmail, selectMirrorFiles, serializeMirrorState,
  type AccountRemote, type DeckFileIo, type ILogger, type LibraryFileSystem, type MirrorPaper, type MirrorStateStore, type PaperRecord, type RelayAccount, type ShareHost,
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
const MIRRORED_ROOTS = ["papers", "projects"];

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
  /** The switch the Account tab shows. */
  remote(): AccountRemote | undefined;
  /** Runs the Mirror once when Remote access is on and Cloudflare is connected; otherwise nothing. Never rejects. */
  run(): Promise<void>;
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

/** The core access and the Mirror runner for one Cloudflare account, over this library's files. */
async function buildMirror(deps: PageRemoteAccessDeps, account: RelayAccount): Promise<{ access: ReturnType<typeof createRemoteAccess>; runner: ReturnType<typeof createMirrorRunner> }> {
  const { sharing, fs, log } = deps;
  const exportDeck = createDeckExporter(fs);
  const state = createBrowserMirrorStateStore(storageArea, readCurrentLibraryId);
  const libraryId = await readCurrentLibraryId();
  const accessToken = createAccessTokenReader(createBackgroundRelayDeps(log), account.credential);
  const relay = createMirrorRelay({
    relayUrl: account.relayUrl, ownerSecret: account.ownerSecret, deviceId: await createBrowserDeviceIdentity(libraryId, log).id(), fetch: fetchNow,
  });
  const runner = createMirrorRunner({
    relay, state, relayUrl: account.relayUrl, hash: deriveTextSha256Hex,
    select: async () => selectMirrorFiles({
      papers: (await deps.papers()).map(mirrorPaper),
      listFiles: async () => (await Promise.all(MIRRORED_ROOTS.map((root) => listFilesUnder(fs, root)))).flat(),
      readText: (path) => fs.readText(path),
      exportDeck,
    }),
  });
  const directory = createDirectoryClient({ accessToken, fetch: fetchNow });
  const access = createRemoteAccess({
    readEmail: async () => readCloudflareEmail(await accessToken()),
    relay, runner, state,
    directory: { self: () => directory.self(), register: async () => { await sharing.setInvitationsEnabled(true); } },
  });
  return { access, runner };
}

/** One run at a time; a request during a run asks for one more run after it. */
function serializeRuns(runOnce: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let queued = false;
  return () => {
    if (running) {
      queued = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          queued = false;
          await runOnce();
        } while (queued);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
}

export function createPageRemoteAccess(deps: PageRemoteAccessDeps): PageRemoteAccess {
  const { relayAccounts, log } = deps;

  const remote: AccountRemote = {
    read: async () => ({ on: await readFlag() }),
    set: async (on) => {
      const account = await relayAccounts.get();
      if (!account) {
        if (on) return { ok: false, message: "Connect Cloudflare first." };
        await writeFlag(false);
        return { ok: true };
      }
      const { access } = await buildMirror(deps, account);
      const result = on ? await access.turnOn() : await access.turnOff();
      if (!result.ok) return { ok: false, message: result.message };
      await writeFlag(on);
      return { ok: true };
    },
  };

  async function runOnce(): Promise<void> {
    try {
      if (!(await readFlag())) return;
      const account = await relayAccounts.get();
      if (!account) return;
      await (await buildMirror(deps, account)).runner.run();
    } catch (error) {
      await log.error("remoteLibrary", error, { action: "mirror run" });
    }
  }

  return { remote: () => remote, run: serializeRuns(runOnce) };
}
