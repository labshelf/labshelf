// Gives the list panel its citation map: OpenAlex data built over the library's cache, and one-click import by DOI.
import { buildCitationMap, createCitationMapView, type CitationMapView, type ImportOutcome } from "@labshelf/core";
import { addTextLayersOfAdded, type ActiveServices } from "../../command/index.js";

export interface CitationMapPorts {
  /** Builds the map; the first build fetches one OpenAlex request per paper with a DOI. */
  buildCitationMap(): Promise<CitationMapView>;
  importByDoi(doi: string): Promise<ImportOutcome>;
}

export function createCitationMapPorts(services: ActiveServices): CitationMapPorts {
  return {
    async buildCitationMap() {
      const papers = await services.paperService.listPapers();
      const map = await buildCitationMap(
        { registry: { fetch: globalThis.fetch, logger: services.logger }, fs: services.fileSystem, cacheDir: services.citationCacheDir, logger: services.logger },
        papers,
      );
      return createCitationMapView(map, papers);
    },
    async importByDoi(doi) {
      const outcome = await services.importer.importFromNetwork(doi);
      addTextLayersOfAdded(services, [outcome]);
      return outcome;
    },
  };
}
