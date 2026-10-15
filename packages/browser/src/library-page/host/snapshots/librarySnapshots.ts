/**
 * Keeps the library UI's snapshot current from IndexedDB, reading again when the page becomes visible or the
 * background reports a change made elsewhere (popup or Scholar capture, attach, sync, reader annotation).
 */
import { PAPERS_DIR, errorMessage, type HostEndpoint, type ILogger, type LibraryUiSnapshot, type PaperRecord, type PaperStats } from "@labshelf/core";
import { bx, type LibraryChangedBroadcast } from "../../../platform";
import { listAllRecords, scanLibrary } from "../../../storage";
import type { SidecarReads } from "./sidecarReads";

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
    const [scan, papers] = await Promise.all([scanLibrary(PAPERS_DIR), listAllRecords()]);
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
        endpoint.post({ type: "notice", kind: "error", text: `Could not load the library — ${errorMessage(err)}` });
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

/** Refreshes when the page shows again or the background broadcasts a library change; returns a disposer. */
export function watchLibraryChanges(snapshots: LibrarySnapshots, log: ILogger): () => void {
  const run = (why: string, work: Promise<void>): void => {
    void work.catch((err: unknown) => log.error("library-page", err, { refreshAfter: why }));
  };
  const onVisible = (): void => {
    if (document.visibilityState === "visible") run("the page became visible", snapshots.reload());
  };
  // Must stay synchronous and return nothing: runtime.sendMessage broadcasts popup requests to extension pages too,
  // and a listener returning a Promise would answer them with undefined.
  const onRuntime = (msg: unknown): void => {
    const change = msg as LibraryChangedBroadcast | undefined;
    if (change?.type !== "library.changed") return;
    if (change.reason === "annotations" && change.paperId) run("an annotation change in the reader", snapshots.sidecarChanged(change.paperId));
    else run("a library change elsewhere", snapshots.reload());
  };
  document.addEventListener("visibilitychange", onVisible);
  bx.runtime.onMessage.addListener(onRuntime);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    bx.runtime.onMessage.removeListener(onRuntime);
  };
}
