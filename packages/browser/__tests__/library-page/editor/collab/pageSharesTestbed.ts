// Builds pages of one browser profile over a shared memory library, IndexedDB, fake Web Locks and a network that reaches no relay.
import "fake-indexeddb/auto";
import { deriveShareId, fileText, type ILogger, type LibraryFileSystem, type RelayNetwork } from "@labshelf/core";
import { createPageShares, saveShare, type PageShares } from "../../../../src/library-page/editor/collab";
import type { LibrarySource, LibrarySources } from "../../../../src/storage";
import { installFakeLocks, type FakeLocks } from "../../../support/fakeLocks";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

export const FOLDER = "projects/thesis";
export const MAIN = `${FOLDER}/main.typ`;
const SHARE_KEY = new Uint8Array(16).fill(7);
const BROWSER: LibrarySource = { kind: "browser", reason: "not-installed" };

const offline: RelayNetwork = {
  fetch: async () => { throw new Error("offline"); },
  socketFactory: () => { throw new Error("offline"); },
};

/** Polls on real timers until `condition` holds. */
export async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) { throw new Error(`condition not met within ${timeoutMs} ms: ${condition.toString()}`); }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A memory file system whose stat reports a fresh mtime per write and the real size. */
function libraryFs(): LibraryFileSystem {
  const inner = memoryLibraryFs();
  const mtimes = new Map<string, number>();
  let clock = 0;
  const fs: LibraryFileSystem = {
    ...inner,
    writeFile: async (path, bytes) => { mtimes.set(path, ++clock); await inner.writeFile(path, bytes); },
    writeText: (path, text) => fs.writeFile(path, new TextEncoder().encode(text)),
    stat: async (path) => {
      const stat = await inner.stat(path);
      return stat?.isFile ? { ...stat, mtimeMs: mtimes.get(path) ?? 0, size: (await inner.readFile(path)).byteLength } : stat;
    },
  };
  return fs;
}

export interface Page {
  shares: PageShares;
  /** Paths this page wrote to the library, in order. */
  writes: string[];
  docText(path: string): string;
}

export interface Profile {
  libraryId: string;
  shareId: string;
  leaseName: string;
  fs: LibraryFileSystem;
  locks: FakeLocks;
  logger: ILogger;
  openPage(): Page;
  /** Ends a page as a killed tab ends: its lock frees, nothing of it is awaited. */
  crash(page: Page): void;
  closeAll(): Promise<void>;
}

let libraries = 0;

/** Seeds a project shared before, with its key stored, in a library no other test uses. */
export async function openProfile(): Promise<Profile> {
  const locks = installFakeLocks();
  Object.assign(globalThis, { document: Object.assign(new EventTarget(), { visibilityState: "visible" }) });
  const libraryId = `lib-${libraries++}`;
  const shareId = await deriveShareId(SHARE_KEY);
  const fs = libraryFs();
  await fs.writeText(`${FOLDER}/labshelf.yaml`, `id: thesis\nshared: ${shareId}\n`);
  await fs.writeText(MAIN, "hello");
  await saveShare(libraryId, shareId, SHARE_KEY, [{ url: "https://relay.example" }]);
  const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const pages: Page[] = [];
  const crashed: Page[] = [];
  return {
    libraryId, shareId, fs, locks, logger,
    leaseName: `labshelf:collab:${libraryId}:${shareId}`,
    openPage: () => {
      const writes: string[] = [];
      const pageFs: LibraryFileSystem = { ...fs, writeFile: async (path, bytes) => { writes.push(path); await fs.writeFile(path, bytes); } };
      pageFs.writeText = (path, text) => pageFs.writeFile(path, new TextEncoder().encode(text));
      const sources = {
        fileSystem: pageFs, browserFileSystem: pageFs, folderFileSystem: pageFs,
        getLibrarySource: async () => BROWSER,
        onLibraryFilesChanged: () => () => undefined,
      } as unknown as LibrarySources;
      const shares = createPageShares({ sources, libraryId: async () => libraryId, logger, network: offline });
      const page: Page = {
        shares, writes,
        docText: (path) => { const active = shares.active("thesis"); return active ? fileText(active.session.openDoc(path)).toString() : ""; },
      };
      pages.push(page);
      return page;
    },
    crash: (page) => {
      locks.kill(`labshelf:collab:${libraryId}:${shareId}`);
      pages.splice(pages.indexOf(page), 1);
      crashed.push(page);
    },
    closeAll: async () => {
      // TRAP: a killed holder's lock request never settles, so releasing its lease never returns; its close only stops its timers.
      crashed.forEach((page) => { void page.shares.closeAll(); }); await Promise.allSettled(pages.map((page) => page.shares.closeAll())); },
  };
}
