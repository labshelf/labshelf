/**
 * Keeps the library UI's snapshot current: reads the folder tree, PDF presence and every paper record from IndexedDB,
 * posts them to the UI, and reads again when the page becomes visible or the background reports a change made
 * elsewhere (a capture from the popup or Scholar, an attach, a sync).
 */
import { PAPERS_DIR, type HostEndpoint, type LibraryUiSnapshot } from "@labshelf/core";
import { bx, type BrowserLogger, type LibraryChangedBroadcast } from "../../platform";
import { listAllRecords, scanLibrary } from "../../storage";
import { errorMessage } from "./runtimeRequests";

export interface LibrarySnapshots {
  /** The first load; a failure becomes an error notice over an empty library. */
  load(): Promise<void>;
  /** Reads again after a change and posts the result. */
  refresh(): Promise<void>;
  /** The last snapshot posted. */
  current(): LibraryUiSnapshot;
}

async function read(): Promise<LibraryUiSnapshot> {
  // One key scan gives both the tree and the PDF presence.
  const [scan, papers] = await Promise.all([scanLibrary(PAPERS_DIR), listAllRecords()]);
  return { folders: scan.tree, papers, pdfDirs: [...scan.pdfDirs] };
}

export function createLibrarySnapshots(endpoint: HostEndpoint): LibrarySnapshots {
  let current: LibraryUiSnapshot = { folders: [], papers: [], pdfDirs: [] };
  const refresh = async (): Promise<void> => {
    current = await read();
    endpoint.post({ type: "snapshot", snapshot: current });
  };
  return {
    refresh,
    current: () => current,
    load: async () => {
      try {
        await refresh();
      } catch (err) {
        endpoint.post({ type: "snapshot", snapshot: current });
        endpoint.post({ type: "notice", kind: "error", text: `Could not load the library — ${errorMessage(err)}` });
      }
    },
  };
}

/** Refreshes when the page shows again or the background broadcasts a library change; returns a disposer. */
export function watchLibraryChanges(snapshots: LibrarySnapshots, log: BrowserLogger): () => void {
  const refresh = (why: string): void => {
    void snapshots.refresh().catch((err: unknown) => log.error("library-page", err, { refreshAfter: why }));
  };
  const onVisible = (): void => { if (document.visibilityState === "visible") refresh("the page became visible"); };
  // Must stay synchronous and return nothing: runtime.sendMessage broadcasts popup requests to extension pages too,
  // and a listener returning a Promise would answer them with undefined.
  const onRuntime = (msg: unknown): void => {
    if ((msg as LibraryChangedBroadcast | undefined)?.type === "library.changed") refresh("a library change elsewhere");
  };
  document.addEventListener("visibilitychange", onVisible);
  bx.runtime.onMessage.addListener(onRuntime);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    bx.runtime.onMessage.removeListener(onRuntime);
  };
}
