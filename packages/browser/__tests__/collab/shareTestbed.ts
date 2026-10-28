// Opens library pages of separate browser profiles that share, join, resume and leave projects through in-process relays.
import "fake-indexeddb/auto";
import type { LibraryFileSystem, ProjectEntry } from "@labshelf/core";
import { createPageShare, type PageShare } from "../../src/collab";
import type { LibraryLocation, LibraryLocations } from "../../src/storage";
import { openCollabDb, createNamespaceRange } from "../../src/storage/collab";
import { installFakeLocks } from "../support/fakeLocks";
import type { RelayNet } from "../support/relayNetwork";
import { libraryFs } from "./pageSharesTestbed";

export const FOLDER = "projects/thesis";
export const MAIN = `${FOLDER}/main.typ`;
export const PROJECT_FILE = `${FOLDER}/labshelf.yaml`;
const BROWSER: LibraryLocation = { kind: "browser", reason: "not-installed" };

export interface SharingPage {
  sharing: PageShare;
  reports: { missingKey: jest.Mock; failed: jest.Mock };
  requireRelay: jest.Mock<Promise<boolean>, []>;
}

export interface SharingLibrary {
  libraryId: string;
  fs: LibraryFileSystem;
  /** Opens a page of the library, as a reload does; `relay: false` has no owner relay connected. */
  open(options?: { relay?: boolean }): SharingPage;
  /** The ready projects the library holds, read from its files by the page opened last. */
  projects(): Promise<ProjectEntry[]>;
  /** Records stored for the share in IndexedDB. */
  storedState(shareId: string): Promise<number>;
  closeAll(): Promise<void>;
}

let libraries = 0;

export function installSharingGlobals(): void {
  installFakeLocks();
  Object.assign(globalThis, { document: Object.assign(new EventTarget(), { visibilityState: "visible" }) });
}

/** A library no other test uses; `seed` writes an unshared typst project at FOLDER. */
export async function openLibrary(net: RelayNet, seed: boolean): Promise<SharingLibrary> {
  const libraryId = `sharing-${libraries++}`;
  const fs = libraryFs();
  if (seed) {
    await fs.writeText(PROJECT_FILE, "id: thesis\ntitle: Thesis\nformat: typst\nmain: main.typ\n");
    await fs.writeText(MAIN, "= Hello\n");
  }
  const sources = {
    fileSystem: fs, browserFileSystem: fs, folderFileSystem: fs,
    getLibrarySource: async () => BROWSER, onLibraryFilesChanged: () => () => undefined,
  } as unknown as LibraryLocations;
  const pages: SharingPage[] = [];
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  return {
    libraryId, fs,
    open: ({ relay = true } = {}) => {
      const reports = { missingKey: jest.fn(), failed: jest.fn() };
      const requireRelay = jest.fn(async () => false);
      const sharing = createPageShare({
        sources, libraryId: async () => libraryId, logger, reports, requireRelay,
        relay: { get: async () => (relay ? net.account : undefined) }, network: net.network, fetch: net.claimFetch,
      });
      const page = { sharing, reports, requireRelay };
      pages.push(page);
      return page;
    },
    projects: async () => {
      const page = pages.at(-1);
      if (!page) { throw new Error("open a page of the library first"); }
      await page.sharing.ports.projects.reload();
      return page.sharing.ports.projects.list().filter((entry) => entry.kind === "ready");
    },
    storedState: async (shareId) => {
      const db = await openCollabDb();
      const range = createNamespaceRange(`${libraryId}/${shareId}`);
      const counts = await Promise.all((["docs", "updates", "maps"] as const).map((store) => db.count(store, range)));
      return counts.reduce((sum, count) => sum + count, 0);
    },
    closeAll: async () => { await Promise.allSettled(pages.map((page) => page.sharing.closeAll())); },
  };
}
