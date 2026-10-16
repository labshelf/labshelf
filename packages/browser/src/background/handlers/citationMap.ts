// Handles the citationMap.* runtime messages: builds the library's citation map and imports a listed work by its DOI.
import { buildCitationMap, joinWith, libraryLayout, type CitationMap, type ILogger } from "@labshelf/core";
import type { ImportedDoiData } from "../../platform";
import { getSettings } from "../../platform";
import { draftFromDoi, saveOrAsk } from "../../capture/index";
import { IndexedDbFileSystem, listAllRecords, type LibraryMutations } from "../../storage";
import { broadcastChanged } from "../broadcast";

const MODULE = "citationMap";

// The cache sits outside the sync roots, so it stays on this device.
const CACHE_DIR = libraryLayout("", joinWith("/")).openAlexCacheDir();

export async function handleCitationMapBuild(log: ILogger): Promise<CitationMap> {
  const [records, settings] = await Promise.all([listAllRecords(), getSettings()]);
  return buildCitationMap(
    { registry: { logger: log, contactEmail: settings.contactEmail }, fs: new IndexedDbFileSystem(), cacheDir: CACHE_DIR, logger: log },
    records,
  );
}

/** Saves the paper behind `doi` without asking about a missing PDF, since the citation map offers one-click import. */
export async function handleCitationMapImportDoi(
  log: ILogger,
  mutations: LibraryMutations,
  doi: string,
  scheduleSync: (reason: string) => void,
): Promise<ImportedDoiData> {
  const draft = await draftFromDoi(log, doi);
  if (draft.existing) {
    void log.log("INFO", MODULE, "DOI already in the library", { doi, id: draft.existing.id });
    return { status: "already-present", id: draft.existing.id, title: draft.existing.title };
  }
  if (!draft.metadata.title) throw new Error(`No registry knows the paper with DOI ${doi}.`);
  const decision = await saveOrAsk(log, mutations, draft, {}, "save");
  if (decision.kind !== "saved") throw new Error("The paper could not be saved.");
  const { paper } = decision.saved;
  scheduleSync("citationMap.import");
  broadcastChanged("capture", paper.id);
  return { status: "saved", id: paper.id, title: paper.title };
}
