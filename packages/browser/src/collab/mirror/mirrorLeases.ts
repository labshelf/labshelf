// Acquires, for a folder source, the folder lease a browser mirror needs next to the caller's tab lease before it writes.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import { acquireFolderLease, type FolderLease, type ILogger, type LeaseHolder, type LeaseScheduler, type LibraryFileSystem } from "@labshelf/core";
import type { LibrarySource, LibrarySources, TabLease } from "../../storage";

export interface MirrorLeaseOptions {
  sources: Pick<LibrarySources, "folderFileSystem" | "browserFileSystem" | "getLibrarySource">;
  /** Held by the caller for the whole share session; the mirror never acquires or releases it. */
  tab: TabLease;
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
  | { kind: "busy"; holder: LeaseHolder }
  | { kind: "owned"; leases: MirrorLeases };

export async function acquireMirrorLeases(options: MirrorLeaseOptions): Promise<MirrorLeasesResult> {
  const { sources, tab, folder, logger, scheduler, takeOver } = options;
  const source = await sources.getLibrarySource();
  if (source.kind === "browser") { return { kind: "owned", leases: { source, fs: sources.browserFileSystem, tab } }; }
  const fs = sources.folderFileSystem;
  const result = await acquireFolderLease({ fs, folder, app: "browser", logger, takeOver, ...(scheduler ? { scheduler } : {}) });
  if (result.kind === "busy") { return result; }
  return { kind: "owned", leases: { source, fs, tab, folder: result.lease } };
}
