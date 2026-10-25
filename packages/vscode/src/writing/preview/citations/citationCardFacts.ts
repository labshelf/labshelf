// Gathers what the citation card shows beyond the library record: highlights, the cited page and the .bib record.
import {
  derivePapersByCiteKey,
  listQuotedHighlights,
  type CitationBibEntry,
  type CitationDetails,
  type CitingCommand,
  type PaperRecord,
  createBibliographyCardEntry,
  parseBibEntries,
} from "@labshelf/core";
import type { PreviewCitationDeps } from "./previewCitations.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import type { CitingSite } from "./citingCommands.js";
import { listUserBibliographyFiles } from "./projectBibliographyFiles.js";

/** The first record of each requested key across the project's user-written .bib files. */
async function projectBibRecords(projectFolder: string, keys: readonly string[]): Promise<Map<string, CitationBibEntry>> {
  const records = new Map<string, CitationBibEntry>();
  for (const document of await listUserBibliographyFiles(projectFolder)) {
    for (const entry of parseBibEntries(document.getText())) {
      if (keys.includes(entry.key) && !records.has(entry.key)) { records.set(entry.key, createBibliographyCardEntry(entry)); }
    }
  }
  return records;
}

const HIGHLIGHTS_SHOWN = 5;

type CardDeps = Pick<PreviewCitationDeps, "logger" | "projectFolder" | "highlightsOf">;

export async function reportWarning(deps: Pick<PreviewCitationDeps, "logger" | "projectFolder">, message: string, error: unknown, context: object = {}): Promise<void> {
  await deps.logger.log("WARN", PREVIEW_LOG_MODULE, message, { projectFolder: deps.projectFolder, ...context, error: String(error) });
}

/** Highlights per paper, cited page first. A part that cannot be read is logged and left out, so the card still answers. */
async function highlightsByPaper(deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[], sites: ReadonlyMap<string, CitingSite>) {
  const cited = derivePapersByCiteKey(papers);
  const highlights = new Map<string, ReturnType<typeof listQuotedHighlights>>();
  for (const key of keys) {
    const paper = cited.get(key);
    if (!paper || highlights.has(paper.id)) { continue; }
    try {
      const quotes = listQuotedHighlights(await deps.highlightsOf(paper.id), HIGHLIGHTS_SHOWN, sites.get(key)?.page);
      if (quotes.length > 0) { highlights.set(paper.id, quotes); }
    } catch (error) {
      await reportWarning(deps, "Reading highlights for the citation card failed", error, { paperId: paper.id });
    }
  }
  return highlights;
}

async function bibRecords(deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[]): Promise<Map<string, CitationBibEntry>> {
  const cited = derivePapersByCiteKey(papers);
  const missing = keys.filter((key) => !cited.has(key));
  if (missing.length === 0) { return new Map(); }
  try {
    return await projectBibRecords(deps.projectFolder, missing);
  } catch (error) {
    await reportWarning(deps, "Reading the .bib records for the citation card failed", error);
    return new Map();
  }
}

export async function readCardDetails(
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
