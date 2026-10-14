/**
 * Reads what the reader's sidecars say about papers, from the same IndexedDB files the reader writes: the stats behind
 * the row marks and the details the detail pane shows.
 */
import {
  PAPERS_DIR, PDF_FILE, PaperDataStore, paperDetailsOf, paperStatsOf, type PaperDetails, type PaperRecord, type PaperStats,
  type SidecarSummarySource,
} from "@labshelf/core";
import type { BrowserLogger } from "../../../platform";
import { IndexedDbFileSystem, createIdbSidecarPort } from "../../../storage";

export interface SidecarReads {
  /** The stats of every paper whose sidecar can be read; an unreadable sidecar only costs that row its marks. */
  statsOf(papers: readonly PaperRecord[]): Promise<Record<string, PaperStats>>;
  /** The stats of one paper, or undefined when its sidecar cannot be read. */
  statsFor(paperId: string): Promise<PaperStats | undefined>;
  /** What the detail pane shows; an unreadable sidecar shows no annotations. */
  details(paper: PaperRecord): Promise<PaperDetails>;
}

export function createSidecarReads(log: BrowserLogger): SidecarReads {
  const fs = new IndexedDbFileSystem();
  const store = new PaperDataStore(createIdbSidecarPort(fs), { logger: log });

  const statsFor = async (paperId: string): Promise<PaperStats | undefined> => {
    try {
      return paperStatsOf(await store.load(paperId));
    } catch (err) {
      void log.warn("Sidecar could not be read for the list", { paperId, message: String(err) });
      return undefined;
    }
  };

  async function pdfOnDevice(paper: PaperRecord): Promise<PaperDetails["pdf"]> {
    const file = `${paper.path}/${PDF_FILE}`;
    const stat = paper.hasPdf === false ? undefined : await fs.stat(file).catch(() => undefined);
    if (!stat?.isFile) return null;
    return { size: stat.size, relPath: file.startsWith(`${PAPERS_DIR}/`) ? file.slice(PAPERS_DIR.length + 1) : file };
  }

  return {
    statsFor,
    async statsOf(papers) {
      const stats: Record<string, PaperStats> = {};
      await Promise.all(papers.map(async (p) => {
        const one = await statsFor(p.id);
        if (one) stats[p.id] = one;
      }));
      return stats;
    },
    async details(paper) {
      let data: SidecarSummarySource = { annotations: [] };
      try {
        data = await store.load(paper.id);
      } catch (err) {
        void log.warn("Sidecar could not be read; showing no annotations", { paperId: paper.id, message: String(err) });
      }
      return paperDetailsOf(data, await pdfOnDevice(paper));
    },
  };
}
