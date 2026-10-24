/** Reads paper sidecars for the library UI: the row stats and the detail pane's summary, logging every unreadable sidecar. */
import type { ILogger } from "../ports/index.js";
import { paperStatsOf, type SidecarSummarySource } from "./derive/index.js";
import type { PaperStats } from "./protocol/index.js";

export interface SidecarReader {
  /** The stats of one paper, or undefined when its sidecar cannot be read. */
  statsFor(paperId: string): Promise<PaperStats | undefined>;
  /** The stats of every paper whose sidecar can be read; an unreadable sidecar only costs that row its marks. */
  statsOf(papers: ReadonlyArray<{ id: string }>): Promise<Record<string, PaperStats>>;
  /** The sidecar of one paper; an unreadable one reads as having no annotations. */
  summaryOf(paperId: string): Promise<SidecarSummarySource>;
}

export function createSidecarReader(load: (paperId: string) => Promise<SidecarSummarySource>, logger: ILogger, module: string): SidecarReader {
  const warn = (message: string, paperId: string, error: unknown): Promise<void> => logger.log("WARN", module, message, { paperId, message: String(error) });

  const statsFor = async (paperId: string): Promise<PaperStats | undefined> => {
    try {
      return paperStatsOf(await load(paperId));
    } catch (error) {
      await warn("Sidecar could not be read for the list", paperId, error);
      return undefined;
    }
  };

  return {
    statsFor,
    async statsOf(papers) {
      const stats: Record<string, PaperStats> = {};
      await Promise.all(papers.map(async ({ id }) => {
        const one = await statsFor(id);
        if (one) stats[id] = one;
      }));
      return stats;
    },
    async summaryOf(paperId) {
      try {
        return await load(paperId);
      } catch (error) {
        await warn("Sidecar could not be read; showing no annotations", paperId, error);
        return { annotations: [] };
      }
    },
  };
}
