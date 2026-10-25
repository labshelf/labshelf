/**
 * Reads what the reader's sidecars say about papers, from the same IndexedDB files the reader writes: the stats behind
 * the row marks and the details the detail pane shows.
 */
import {
  PAPERS_DIR, PDF_FILE, PaperSidecarStore, createSidecarReader, derivePaperDetails, type ILogger, type PaperDetails, type PaperRecord, type PaperStats,
} from "@labshelf/core";
import { createLibraryFileSystem, createSidecarPort } from "../../../storage";

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
