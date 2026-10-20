// Acquires the tab lease and, for a folder source, the folder lease a browser mirror needs before it writes.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import { acquireFolderLease, type FolderLease, type ILogger, type LeaseHolder, type LeaseScheduler, type LibraryFileSystem } from "@labshelf/core";
import { acquireTabLease, takeOverTabLease, tabLeaseName, type LibrarySource, type LibrarySources, type TabLease } from "../../../../storage";

export interface MirrorLeaseOptions {
  sources: Pick<LibrarySources, "folderFileSystem" | "browserFileSystem" | "getLibrarySource">;
  libraryId: string;
  shareId: string;
  folder: string;
  logger: ILogger;
  scheduler?: LeaseScheduler;
  takeOver: boolean;
}

export interface MirrorLeases {
  /** The source the leases were taken on; the mirror stops when the library moves to another. */
  source: LibrarySource;
  /** The file system of `source` alone, so a later source choice cannot redirect the mirror's writes. */
  fs: LibraryFileSystem;
  tab: TabLease;
  /** Absent for browser storage, which only this profile's tabs can reach. */
  folder?: FolderLease;
}

export type MirrorLeasesResult =
  | { kind: "busy"; holder: "tab" | LeaseHolder }
  | { kind: "owned"; leases: MirrorLeases };

async function tabLeaseFor(options: MirrorLeaseOptions): Promise<TabLease | undefined> {
  const name = tabLeaseName(options.libraryId, options.shareId);
  if (options.takeOver) { return takeOverTabLease(name); }
  const result = await acquireTabLease(name);
  return result.kind === "owned" ? result.lease : undefined;
}

export async function acquireMirrorLeases(options: MirrorLeaseOptions): Promise<MirrorLeasesResult> {
  const { sources, folder, logger, scheduler, takeOver } = options;
  const tab = await tabLeaseFor(options);
  if (!tab) { return { kind: "busy", holder: "tab" }; }
  try {
    const source = await sources.getLibrarySource();
    if (source.kind === "browser") { return { kind: "owned", leases: { source, fs: sources.browserFileSystem, tab } }; }
    const fs = sources.folderFileSystem;
    const result = await acquireFolderLease({ fs, folder, app: "browser", logger, takeOver, ...(scheduler ? { scheduler } : {}) });
    if (result.kind === "busy") {
      await tab.release();
      return result;
    }
    return { kind: "owned", leases: { source, fs, tab, folder: result.lease } };
  } catch (error) {
    await tab.release();
    throw error;
  }
}
