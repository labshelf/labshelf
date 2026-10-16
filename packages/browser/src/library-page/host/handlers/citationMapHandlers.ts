// Answers the citation map view: builds the map in the background, names the library papers it mentions, and imports a listed work by DOI.
import { citationMapView, errorMessage, type CitationMap } from "@labshelf/core";
import { sendRuntime, type ImportedDoiData } from "../../../platform";
import type { HostContext } from "../hostContext";

export interface CitationMapHandlers {
  /** Opens the view, or refreshes it while it is open. */
  open(): Promise<void>;
  /** Imports the work by DOI; the UI's busy button clears on `citationMap.imported` or `citationMap.importFailed`. */
  importWork(workId: string, doi: string): Promise<void>;
}

export function createCitationMapHandlers(ctx: HostContext): CitationMapHandlers {
  return {
    async open() {
      ctx.endpoint.post({ type: "citationMap.show", state: { status: "loading" } });
      try {
        const map = await sendRuntime<CitationMap>({ type: "citationMap.build" });
        ctx.endpoint.post({ type: "citationMap.show", state: { status: "ready", map: citationMapView(map, ctx.snapshots.current().papers) } });
      } catch (err: unknown) {
        void ctx.log.error("library-page", err, { op: "citationMap.build" });
        ctx.endpoint.post({ type: "citationMap.show", state: { status: "failed", message: errorMessage(err) } });
      }
    },
    async importWork(workId, doi) {
      try {
        const saved = await sendRuntime<ImportedDoiData>({ type: "citationMap.importDoi", doi });
        await ctx.snapshots.refresh();
        ctx.notice("ok", saved.status === "saved" ? `Imported "${saved.title}"` : `"${saved.title}" is already in your library`);
        ctx.endpoint.post({ type: "citationMap.imported", workId });
      } catch (err: unknown) {
        void ctx.log.error("library-page", err, { op: "citationMap.import", workId, doi });
        ctx.notice("error", errorMessage(err));
        ctx.endpoint.post({ type: "citationMap.importFailed", workId });
      }
    },
  };
}
