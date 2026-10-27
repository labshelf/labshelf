/**
 * Keeps the library UI's snapshot current from IndexedDB, reading again when the page becomes visible or the
 * background reports a change made elsewhere (popup or Scholar capture, attach, reader annotation); also reads what the
 * reader's sidecars say about papers (the stats behind the row marks and the details the detail pane shows).
 */
import {
  PAPERS_DIR, PDF_FILE, PaperSidecarStore, createSidecarReader, derivePaperDetails, formatError,
  type HostEndpoint, type ILogger, type LibraryUiSnapshot, type PaperDetails, type PaperRecord, type PaperStats,
} from "@labshelf/core";
import { watchVisibility, type LibraryChangedEvent } from "../../platform";
import { createLibraryFileSystem, createSidecarPort, listCachedPaperRecords, onPaperRecordsRebuilt, scanLibrary } from "../../storage";

// ---- Sidecar reads
export interface SidecarReads {
  /** The stats of every paper whose sidecar can be read; an unreadable sidecar only costs that row its marks. */
  statsOf(papers: readonly PaperRecord[]): Promise<Record<string, PaperStats>>;
  /** The stats of one paper, or undefined when its sidecar cannot be read. */
  statsFor(paperId: string): Promise<PaperStats | undefined>;
  /** What the detail pane shows; an unreadable sidecar shows no annotations. */
  details(paper: PaperRecord): Promise<PaperDetails>;
}

export function createSidecarReads(log: ILogger): SidecarReads {
  const fs = createLibraryFileSystem();
  const store = new PaperSidecarStore(createSidecarPort(fs), { logger: log });
  const reader = createSidecarReader((id) => store.load(id), log, "libraryUi/sidecars");

  async function pdfOnDevice(paper: PaperRecord): Promise<PaperDetails["pdf"]> {
    const file = `${paper.path}/${PDF_FILE}`;
    const stat = paper.hasPdf === false ? undefined : await fs.stat(file).catch(() => undefined);
    if (!stat?.isFile) return null;
    return { size: stat.size, relPath: file.startsWith(`${PAPERS_DIR}/`) ? file.slice(PAPERS_DIR.length + 1) : file };
  }

  return {
    statsFor: reader.statsFor,
    statsOf: reader.statsOf,
    async details(paper) {
      return derivePaperDetails(await reader.summaryOf(paper.id), await pdfOnDevice(paper));
    },
  };
}

// ---- Snapshots
export interface LibrarySnapshots {
  /** The first load; a failure becomes an error notice over an empty library. */
  load(): Promise<void>;
  /** Reads the records, folders and PDF presence again after a change here and posts the result; reading stats stay. */
  refresh(): Promise<void>;
  /** Reads everything again, every sidecar included, after a change made elsewhere. */
  reload(): Promise<void>;
  /**
   * A paper's sidecar changed: posts a snapshot with its new stats, or just `sidecarChanged` when its marks are the
   * same, so the detail pane asks for the paper's data again exactly once.
   */
  sidecarChanged(paperId: string): Promise<void>;
  /** The last snapshot posted. */
  current(): LibraryUiSnapshot;
}

const sameStats = (a: PaperStats | undefined, b: PaperStats | undefined): boolean =>
  a?.annotations === b?.annotations && a?.lastPage === b?.lastPage && a?.lastRead === b?.lastRead;

const keepStatsOf = (papers: readonly PaperRecord[], stats: Record<string, PaperStats>): Record<string, PaperStats> =>
  Object.fromEntries(papers.flatMap((p) => (stats[p.id] ? [[p.id, stats[p.id]!]] : [])));

export function createLibrarySnapshots(endpoint: HostEndpoint, sidecars: SidecarReads): LibrarySnapshots {
  let current: LibraryUiSnapshot = { folders: [], papers: [], pdfDirs: [], stats: {} };
  const post = async (rereadStats: boolean): Promise<void> => {
    // One key scan gives both the tree and the PDF presence.
    const [scan, papers] = await Promise.all([scanLibrary(PAPERS_DIR), listCachedPaperRecords()]);
    const stats = rereadStats ? await sidecars.statsOf(papers) : keepStatsOf(papers, current.stats);
    current = { folders: scan.tree, papers, pdfDirs: [...scan.pdfDirs], stats };
    endpoint.post({ type: "snapshot", snapshot: current });
  };
  return {
    refresh: () => post(false),
    reload: () => post(true),
    current: () => current,
    async load() {
      try {
        await post(true);
      } catch (err) {
        endpoint.post({ type: "snapshot", snapshot: current });
        endpoint.post({ type: "notice", kind: "error", text: `Could not load the library — ${formatError(err)}` });
      }
    },
    async sidecarChanged(paperId) {
      const stats = await sidecars.statsFor(paperId);
      if (sameStats(stats, current.stats[paperId])) {
        endpoint.post({ type: "sidecarChanged", id: paperId });
        return;
      }
      const next = { ...current.stats };
      if (stats) next[paperId] = stats;
      else delete next[paperId];
      current = { ...current, stats: next };
      endpoint.post({ type: "snapshot", snapshot: current });
    },
  };
}

/** Refreshes when the page shows again, the background broadcasts a library change or the folder's records finish rebuilding; returns a disposer. */
export function watchLibraryChanges(snapshots: LibrarySnapshots, log: ILogger): () => void {
  const run = (why: string, work: Promise<void>): void => {
    void work.catch((err: unknown) => log.error("libraryUi", err, { refreshAfter: why }));
  };
  const stopVisibility = watchVisibility({
    onVisible: () => run("the page became visible", snapshots.reload()),
    onMessage: (msg) => {
      const change = msg as LibraryChangedEvent | undefined;
      if (change?.type !== "library.changed") return;
      if (change.reason === "annotations" && change.paperId) run("an annotation change in the reader", snapshots.sidecarChanged(change.paperId));
      else run("a library change elsewhere", snapshots.reload());
    },
  });
  // The background's broadcast does not reach the context that ran the rebuild, so this page listens to its own.
  const stopRebuilt = onPaperRecordsRebuilt(() => run("the folder's records were rebuilt", snapshots.reload()));
  return () => {
    stopRebuilt();
    stopVisibility();
  };
}
