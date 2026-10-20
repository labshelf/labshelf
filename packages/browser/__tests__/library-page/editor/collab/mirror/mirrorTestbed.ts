// Builds a browser project mirror over in-memory library sources, IndexedDB share state, a held tab lease and a hand-driven lease clock.
import "fake-indexeddb/auto";
import {
  attachBlobs, createProjectIndex, createShareSession, deriveContentKey, fileText, indexFiles, openCollabStore, replaceFileText,
  type BlobExchange, type CollabStore, type ILogger, type LeaseScheduler, type LibraryFileSystem, type ShareSession,
} from "@labshelf/core";
import {
  startBrowserProjectMirror, type BrowserMirrorStart, type BrowserMirrorStopReason, type BrowserProjectMirror,
} from "../../../../../src/library-page/editor/collab/mirror";
import { acquireTabLease, tabLeaseName, type LibrarySource, type TabLease } from "../../../../../src/storage";
import { openBrowserCollabStorage } from "../../../../../src/storage/collaboration";
import { installFakeLocks } from "../../../../support/fakeLocks";
import { loopback } from "../../../../support/loopbackRelay";
import { memoryLibraryFs } from "../../../../support/memoryLibraryFs";

export const LIBRARY_ID = "lib-1";
export const SHARE_ID = "f".repeat(32);
export const FOLDER = "projects/thesis";
const SHARE_KEY = new Uint8Array(16).fill(1);
const BROWSER: LibrarySource = { kind: "browser", reason: "not-installed" };
const FOLDER_SOURCE: LibrarySource = { kind: "folder", root: "/home/me/library", via: "picked" };

/** A memory file system whose stat reports a fresh mtime per write and the real size, and which can lose its permission. */
export interface TestFs extends LibraryFileSystem {
  /** Every path written, in order. */
  writes: string[];
  /** While true every call throws, as a folder whose permission was revoked does. */
  failing: boolean;
  text(path: string): Promise<string | undefined>;
}

function testFs(): TestFs {
  const inner = memoryLibraryFs();
  const mtimes = new Map<string, number>();
  let clock = 0;
  const guard = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    if (fs.failing) { throw new DOMException("The folder permission was revoked", "NotAllowedError"); }
    return call(...args);
  };
  const fs: TestFs = {
    ...inner,
    writes: [],
    failing: false,
    writeFile: guard(async (path: string, bytes: Uint8Array) => { fs.writes.push(path); mtimes.set(path, ++clock); await inner.writeFile(path, bytes); }),
    writeText: (path, text) => fs.writeFile(path, new TextEncoder().encode(text)),
    readFile: guard(inner.readFile),
    readText: guard(inner.readText),
    exists: guard(inner.exists),
    listDir: guard(inner.listDir),
    deleteFile: guard(inner.deleteFile),
    stat: guard(async (path: string) => {
      const stat = await inner.stat(path);
      return stat?.isFile ? { ...stat, mtimeMs: mtimes.get(path) ?? 0, size: (await inner.readFile(path)).byteLength } : stat;
    }),
    text: async (path) => ((await inner.exists(path)) ? inner.readText(path) : undefined),
  };
  return fs;
}

/** Resolves every delay at once and runs the periodic tasks only when the test fires them. */
export interface ManualScheduler extends LeaseScheduler { fire(): void }

function manualScheduler(): ManualScheduler {
  const tasks = new Set<() => void>();
  return {
    now: () => Date.now(),
    delay: async () => undefined,
    every: (_ms, task) => { const entry = () => task(); tasks.add(entry); return () => { tasks.delete(entry); }; },
    fire: () => { for (const task of [...tasks]) { task(); } },
  };
}

export interface Testbed {
  browserFs: TestFs;
  folderFs: TestFs;
  scheduler: ManualScheduler;
  session: ShareSession;
  logger: ILogger;
  /** The share's tab lease the testbed holds, as the page does for the share session. */
  tab: TabLease;
  /** The stop reasons of the mirrors started without their own list. */
  stops: BrowserMirrorStopReason[];
  start(stops?: BrowserMirrorStopReason[]): Promise<BrowserMirrorStart>;
  /** Sets a text file in the share as a peer's edit does. */
  peerEdit(path: string, text: string): void;
  docText(path: string): string;
  close(): Promise<void>;
}

let namespaces = 0;

export async function openTestbed(source: "browser" | "folder"): Promise<Testbed> {
  installFakeLocks();
  Object.assign(globalThis, { document: Object.assign(new EventTarget(), { visibilityState: "visible" }) });
  const [browserFs, folderFs, scheduler] = [testFs(), testFs(), manualScheduler()];
  await browserFs.mkdir(FOLDER);
  await folderFs.mkdir(FOLDER);
  const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const contentKey = await deriveContentKey(SHARE_KEY);
  const store: CollabStore = await openCollabStore({ storage: openBrowserCollabStorage(`mirror-test-${namespaces++}`), logger });
  const session = createShareSession({
    shareId: SHARE_ID, contentKey, transport: loopback()("a"), logger, index: store.index, createDoc: store.createDoc,
  });
  createProjectIndex(session.index);
  const blobs: BlobExchange = attachBlobs(session, { contentKey, getBlob: (hash) => store.blobs.get(hash), logger, skipPeer: () => false });
  const listeners = new Set<(paths: string[]) => void>();
  const sources = {
    browserFileSystem: browserFs,
    folderFileSystem: folderFs,
    getLibrarySource: async () => (source === "browser" ? BROWSER : FOLDER_SOURCE),
    onLibraryFilesChanged: (listener: (paths: string[]) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const held = await acquireTabLease(tabLeaseName(LIBRARY_ID, SHARE_ID));
  if (held.kind !== "owned") { throw new Error("expected the testbed to own the tab lease"); }
  const tab = held.lease;
  const mirrors: BrowserProjectMirror[] = [];
  const stops: BrowserMirrorStopReason[] = [];
  const track = (result: BrowserMirrorStart): BrowserMirrorStart => {
    if (result.kind === "running") { mirrors.push(result.mirror); return result; }
    return { ...result, takeOver: async () => track(await result.takeOver()) };
  };
  return {
    browserFs, folderFs, scheduler, session, logger, tab, stops,
    start: async (into = stops) => track(await startBrowserProjectMirror({
      sources, tab, libraryId: LIBRARY_ID, shareId: SHARE_ID, folder: FOLDER, session, blobs, store, logger, scheduler,
      onStopped: (reason) => { into.push(reason); },
    })),
    peerEdit: (path, text) => {
      replaceFileText(session.openDoc(path), text, "remote");
      indexFiles(session.index).set(path, { kind: "text" });
    },
    docText: (path) => fileText(session.openDoc(path)).toString(),
    close: async () => {
      await Promise.all(mirrors.map((mirror) => mirror.close()));
      await tab.release();
      blobs.close();
      await session.close();
      await store.close();
    },
  };
}

export function running(result: BrowserMirrorStart): BrowserProjectMirror {
  if (result.kind !== "running") { throw new Error(`expected a running mirror, got ${result.kind}`); }
  return result.mirror;
}

/** Polls until `done` holds, running `step` before each check. */
export async function until(done: () => boolean | Promise<boolean>, step: () => void = () => undefined): Promise<void> {
  for (let i = 0; i < 200; i++) {
    step();
    if (await done()) { return; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await done()).toBe(true);
}
