// The catalogs the page's share workflows read, its projects and its Spaces, and the Space side of every connected Space share: the deps of attachSpaceShare and its start and stop as connections come and go.
// CONTRACT: documents/contracts/collaboration.md#space-shares
import {
  attachSpaceShare, createLibraryLayout, posixPathOps, PDF_FILE,
  type ILogger, type LibraryFileSystem, type LibraryPapers, type ProjectEntry, type ShareConnection, type SharedSpaceCatalog, type ShareFlowPorts, type SpaceShareDeps, type SpaceStore,
} from "@labshelf/core";
import { createBrowserProjects } from "../storage";
import type { ShareSources } from "./register";

/** The project list the workflows read; `reload` re-reads the library's projects and then calls `reloaded`. */
export interface BrowserShareCatalog {
  list(): readonly ProjectEntry[];
  reload(): Promise<void>;
}

export function createBrowserShareCatalog(sources: ShareSources, logger: ILogger, reloaded: () => void): BrowserShareCatalog {
  const projects = createBrowserProjects({ fileSystem: sources.fileSystem, logger });
  let entries: readonly ProjectEntry[] = [];
  return {
    list: () => entries,
    reload: async () => {
      entries = await projects.listBrowserProjects();
      reloaded();
    },
  };
}

/** What the page gives its sharing about its Spaces and library; `papers` holds the library's paper records. */
export interface PageShareSpaces {
  store: SpaceStore;
  papers(): LibraryPapers;
  onPapersChange(listener: () => void): () => void;
  /** The bytes of the paper's PDF; undefined when it has none on this device. */
  readPdf(paperId: string): Promise<Uint8Array | undefined>;
}

// The browser library root is "" with POSIX paths, so a Space lives in `spaces/<id>`.
const layout = createLibraryLayout("", (base, ...segments) => posixPathOps.join(base, ...segments));

/** The readable Spaces of the store, Trash included; `reload` re-reads the files, so a Space a join created shows at once. */
export function createSpaceShareCatalog(store: Pick<SpaceStore, "list" | "reload">): SharedSpaceCatalog {
  return {
    list: () => store.list().flatMap((read) => read.state === "ready"
      ? [{ id: read.space.id, name: read.space.name, folder: layout.spaceDir(read.space.id), ...(read.space.shared === undefined ? {} : { shared: read.space.shared }) }]
      : []),
    reload: async () => { await store.reload(); },
  };
}

/** Reads `<paper folder>/paper.pdf` of a paper the records hold; a missing or unreadable file reads as none. */
export function createPaperPdfReader(fs: LibraryFileSystem, papers: () => LibraryPapers): (paperId: string) => Promise<Uint8Array | undefined> {
  return async (paperId) => {
    const record = papers().get(paperId)?.record;
    if (!record) { return undefined; }
    const path = posixPathOps.join(record.path, PDF_FILE);
    return (await fs.stat(path))?.isFile ? fs.readFile(path).catch(() => undefined) : undefined;
  };
}

export function createSpaceShareDeps(ports: ShareFlowPorts, spaces: PageShareSpaces, onProjectsChange: (listener: () => void) => () => void): SpaceShareDeps {
  return { ports, spaces: spaces.store, papers: spaces.papers, onPapersChange: spaces.onPapersChange, onProjectsChange, readPdf: spaces.readPdf };
}

interface SpaceShareSource {
  list(): readonly ShareConnection[];
  onChange(listener: () => void): () => void;
}

/**
 * Runs `attach` for every listed connection of a Space share and its stop once the connection leaves the list, a connection
 * that replaced another of the same share (a reopen) included; the returned function stops them all.
 */
export function trackSpaceShares(shares: SpaceShareSource, attach: (connection: ShareConnection) => () => void): () => void {
  const attached = new Map<ShareConnection, () => void>();
  const sync = (): void => {
    const listed = new Set(shares.list().filter((connection) => connection.kind === "space"));
    for (const [connection, stop] of attached) {
      if (!listed.has(connection)) { attached.delete(connection); stop(); }
    }
    for (const connection of listed) {
      if (!attached.has(connection)) { attached.set(connection, attach(connection)); }
    }
  };
  const stopListening = shares.onChange(sync);
  sync();
  return () => {
    stopListening();
    [...attached.values()].forEach((stop) => stop());
    attached.clear();
  };
}

/** Starts the Space side of every connected Space share of the page. */
export function runSpaceShares(shares: SpaceShareSource, deps: SpaceShareDeps): () => void {
  return trackSpaceShares(shares, (connection) => attachSpaceShare(connection, deps));
}
