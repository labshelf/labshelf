// Gathers what the citation card shows beyond the library record: highlights, the cited page and the .bib record.
import {
  papersByCiteKey, quotedHighlights,
  type CitationBibEntry, type CitationDetails, type CitingCommand, type PaperRecord,
} from "@labshelf/core";
import type { PreviewCitationDeps } from "./previewCitations.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import { projectBibRecords } from "./projectBibliographyEntries.js";
import type { CitingSite } from "./citingCommands.js";

const HIGHLIGHTS_SHOWN = 5;

type CardDeps = Pick<PreviewCitationDeps, "logger" | "projectFolder" | "highlightsOf">;

export async function warn(deps: Pick<PreviewCitationDeps, "logger" | "projectFolder">, message: string, error: unknown, context: object = {}): Promise<void> {
  await deps.logger.log("WARN", PREVIEW_LOG_MODULE, message, { projectFolder: deps.projectFolder, ...context, error: String(error) });
}

/** Highlights per paper, cited page first. A part that cannot be read is logged and left out, so the card still answers. */
async function highlightsByPaper(deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[], sites: ReadonlyMap<string, CitingSite>) {
  const cited = papersByCiteKey(papers);
  const highlights = new Map<string, ReturnType<typeof quotedHighlights>>();
  for (const key of keys) {
    const paper = cited.get(key);
    if (!paper || highlights.has(paper.id)) { continue; }
    try {
      const quotes = quotedHighlights(await deps.highlightsOf(paper.id), HIGHLIGHTS_SHOWN, sites.get(key)?.page);
      if (quotes.length > 0) { highlights.set(paper.id, quotes); }
    } catch (error) {
      await warn(deps, "Reading highlights for the citation card failed", error, { paperId: paper.id });
    }
  }
  return highlights;
}

async function bibRecords(deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[]): Promise<Map<string, CitationBibEntry>> {
  const cited = papersByCiteKey(papers);
  const missing = keys.filter((key) => !cited.has(key));
  if (missing.length === 0) { return new Map(); }
  try {
    return await projectBibRecords(deps.projectFolder, missing);
  } catch (error) {
    await warn(deps, "Reading the .bib records for the citation card failed", error);
    return new Map();
  }
}

export async function cardDetails(
  deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[], sites: ReadonlyMap<string, CitingSite>,
): Promise<CitationDetails> {
  const site = new Map<string, CitingCommand>();
  const citedPage = new Map<string, number>();
  for (const [key, found] of sites) {
    site.set(key, found.command);
    if (found.page !== undefined) { citedPage.set(key, found.page); }
  }
  return {
    highlights: await highlightsByPaper(deps, keys, papers, sites),
    bib: await bibRecords(deps, keys, papers),
    site,
    citedPage,
  };
}
