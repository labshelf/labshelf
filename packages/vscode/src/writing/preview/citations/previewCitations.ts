// Answers the preview reader's citation requests: which library papers a link or text cites, and opening one of them.
import * as vscode from "vscode";

import {
  deriveCitationEntries, findCiteKeysAt,
  type Annotation, type CitationEntry, type CitationQuery, type ILogger, type PagePoint, type PaperRecord, type PathOps, type ProjectFormat, type TypstCite,
} from "@labshelf/core";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import type { SynctexFinder } from "../synctex/index.js";
import { readCardDetails, reportWarning } from "./citationCardFacts.js";
import { listCitingSites, type CitingSite } from "./citingCommands.js";
import { findSourceLine, type LocatedSourceLine } from "./findSourceLine.js";

export interface PreviewCitationDeps {
  logger: ILogger;
  projectFolder: string;
  paths: PathOps;
  format: ProjectFormat;
  listPapers: () => Promise<PaperRecord[]>;
  /** Where the Typst build behind the shown PDF placed its citations. */
  typstCites: () => readonly TypstCite[];
  synctex: () => Promise<SynctexFinder>;
  highlightsOf: (paperId: string) => Promise<Annotation[]>;
}

function areaCenter(area: CitationQuery["area"]): PagePoint {
  return { page: area.page, x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
}

/** Answers with no entries on a failure; a hover must not raise a notice every time. */
export async function findCitation(deps: PreviewCitationDeps, query: CitationQuery): Promise<CitationEntry[]> {
  try {
    // The source line behind the place is read once: it finds the keys of a LaTeX text and the citing command of every key.
    let located: Promise<LocatedSourceLine | undefined> | undefined;
    const locate = (point: PagePoint): Promise<LocatedSourceLine | undefined> => (located ??= findSourceLine(deps.synctex, point));
    const keys = await findCiteKeysAt(query, { format: deps.format, typstCites: deps.typstCites(), sourceLineAt: locate });
    if (keys.length === 0) { return []; }
    const papers = await deps.listPapers();
    const sites = deps.format === "latex" ? await citingSitesAt(deps, keys, () => locate(areaCenter(query.area))) : new Map<string, CitingSite>();
    return deriveCitationEntries(keys, papers, await readCardDetails(deps, keys, papers, sites));
  } catch (error) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Citation lookup failed", { projectFolder: deps.projectFolder, page: query.area.page, error: String(error) });
    return [];
  }
}

/** The citing commands are extra: a source that cannot be read is logged and the card answers without them. */
async function citingSitesAt(
  deps: PreviewCitationDeps, keys: readonly string[], locate: () => Promise<LocatedSourceLine | undefined>,
): Promise<Map<string, CitingSite>> {
  try {
    const source = await locate();
    return source ? listCitingSites(deps.paths, deps.format, deps.projectFolder, source, keys) : new Map();
  } catch (error) {
    await reportWarning(deps, "Reading the citing source for the citation card failed", error);
    return new Map();
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
