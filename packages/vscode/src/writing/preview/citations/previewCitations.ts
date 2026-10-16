// Answers the preview reader's citation requests: which library papers a link or text cites, and opening one of them.
import * as vscode from "vscode";

import {
  citationEntries, citedKeysAt, papersByCiteKey, quotedHighlights,
  type Annotation, type CitationDetails, type CitationEntry, type CitationQuery, type ILogger, type PaperRecord, type ProjectFormat, type TypstCite,
} from "@labshelf/core";
import type { CiteSections } from "../../citations/index.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import type { SynctexLookup } from "../sourceLinks/index.js";
import { sourceLineAt } from "./sourceLineAt.js";

export interface PreviewCitationDeps {
  logger: ILogger;
  projectFolder: string;
  format: ProjectFormat;
  listPapers: () => Promise<PaperRecord[]>;
  /** Where the Typst build behind the shown PDF placed its citations. */
  typstCites: () => readonly TypstCite[];
  synctex: () => Promise<SynctexLookup>;
  highlightsOf: (paperId: string) => Promise<Annotation[]>;
  /** Which sections of the previewed project cite each key. */
  citeSections: () => Promise<Pick<CiteSections, "byKey">>;
}

const HIGHLIGHTS_SHOWN = 5;

async function warn(deps: PreviewCitationDeps, message: string, error: unknown, context: object = {}): Promise<void> {
  await deps.logger.log("WARN", PREVIEW_LOG_MODULE, message, { projectFolder: deps.projectFolder, ...context, error: String(error) });
}

/** A part that cannot be read is logged and left out, so the card still answers. */
async function cardDetails(deps: PreviewCitationDeps, keys: readonly string[], papers: readonly PaperRecord[]): Promise<CitationDetails> {
  const cited = papersByCiteKey(papers);
  const highlights = new Map<string, ReturnType<typeof quotedHighlights>>();
  for (const paper of new Set(keys.flatMap((key) => cited.get(key) ?? []))) {
    try {
      const quotes = quotedHighlights(await deps.highlightsOf(paper.id), HIGHLIGHTS_SHOWN);
      if (quotes.length > 0) { highlights.set(paper.id, quotes); }
    } catch (error) {
      await warn(deps, "Reading highlights for the citation card failed", error, { paperId: paper.id });
    }
  }
  const citedIn = new Map<string, string[]>();
  try {
    const { byKey } = await deps.citeSections();
    for (const key of keys) {
      const titles = [...new Set((byKey.get(key) ?? []).map((section) => section.title))];
      if (titles.length > 0) { citedIn.set(key, titles); }
    }
  } catch (error) {
    await warn(deps, "Reading the citing sections for the citation card failed", error);
  }
  return { highlights, citedIn };
}

/** Answers with no entries on a failure; a hover must not raise a notice every time. */
export async function lookupCitation(deps: PreviewCitationDeps, query: CitationQuery): Promise<CitationEntry[]> {
  try {
    const keys = await citedKeysAt(query, {
      format: deps.format,
      typstCites: deps.typstCites(),
      sourceLineAt: (point) => sourceLineAt(deps.synctex, point),
    });
    if (keys.length === 0) { return []; }
    const papers = await deps.listPapers();
    return citationEntries(keys, papers, await cardDetails(deps, keys, papers));
  } catch (error) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Citation lookup failed", { projectFolder: deps.projectFolder, page: query.area.page, error: String(error) });
    return [];
  }
}

/** The id comes from the webview, so only a paper of the library opens. */
export async function openCitedPaper(deps: PreviewCitationDeps, paperId: string): Promise<void> {
  const { logger, projectFolder } = deps;
  try {
    if (!(await deps.listPapers()).some((paper) => paper.id === paperId)) {
      await logger.log("WARN", PREVIEW_LOG_MODULE, "Preview asked to open a paper that is not in the library", { projectFolder, paperId });
      return;
    }
    await vscode.commands.executeCommand("labshelf.openPdfViewer", paperId);
    await logger.log("INFO", PREVIEW_LOG_MODULE, "Opened cited paper from the preview", { projectFolder, paperId });
  } catch (error) {
    await logger.error(PREVIEW_LOG_MODULE, error, { projectFolder, paperId });
  }
}
