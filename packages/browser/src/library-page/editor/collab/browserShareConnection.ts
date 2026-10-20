// Connects the page to one shared project through the core share connection, with its state in IndexedDB and the browser disk mirror.
import {
  connectShare, posixPathOps,
  type ILogger, type Invite, type MirrorFactory, type MirrorStart, type ProjectFolderRegistry, type RelayNetwork, type ShareConnection, type ShareStart,
} from "@labshelf/core";
import { openBrowserCollabStorage, type LibrarySources, type TabLease } from "../../../storage";
import { startBrowserProjectMirror, type BrowserMirrorStart } from "./mirror";

export type ShareSources = Pick<LibrarySources, "fileSystem" | "folderFileSystem" | "browserFileSystem" | "getLibrarySource" | "onLibraryFilesChanged">;

export interface BrowserShareOptions {
  invite: Pick<Invite, "shareId" | "shareKey" | "relays">;
  /** The library the project lives in; the share's state is stored under it. */
  libraryId: string;
  /** The share's tab lease, held by the caller for the whole connection. */
  tab: TabLease;
  sources: ShareSources;
  name: string;
  logger: ILogger;
  network?: RelayNetwork | undefined;
  start: ShareStart;
}

// The browser library keeps every project inside the library, so it has no outside folders to register.
const noOutsideFolders: ProjectFolderRegistry = { folders: async () => [], register: async () => undefined, unregister: async () => undefined };

function toMirrorStart(result: BrowserMirrorStart): MirrorStart {
  return result.kind === "running" ? result : { kind: "busy", holder: result.holder };
}

export function connectBrowserShare({ invite, libraryId, tab, sources, name, logger, network, start }: BrowserShareOptions): Promise<ShareConnection> {
  const { shareId, shareKey, relays } = invite;
  const startMirror: MirrorFactory = async ({ folder, session, blobs, store, onStopped }) => toMirrorStart(await startBrowserProjectMirror({
    sources, libraryId, shareId, folder, session, blobs, store, logger, tab, onStopped,
  }));
  return connectShare({
    shareId, shareKey, relays, name, logger, startMirror,
    storage: openBrowserCollabStorage(`${libraryId}/${shareId}`),
    projects: { context: { fs: sources.fileSystem, paths: posixPathOps, logger, registry: noOutsideFolders }, libraryRoot: "" },
    ...(network ? { network } : {}),
  }, start);
}
