// Answers the preview reader's citation requests: which library papers a link or text cites, and opening one of them.
import * as vscode from "vscode";

import {
  citationEntries, citedKeysAt, type CitationEntry, type CitationQuery, type ILogger, type PaperRecord, type ProjectFormat, type TypstCite,
} from "@labshelf/core";
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
}

/** Answers with no entries on a failure; a hover must not raise a notice every time. */
export async function lookupCitation(deps: PreviewCitationDeps, query: CitationQuery): Promise<CitationEntry[]> {
  try {
    const keys = await citedKeysAt(query, {
      format: deps.format,
      typstCites: deps.typstCites(),
      sourceLineAt: (point) => sourceLineAt(deps.synctex, point),
    });
    return citationEntries(keys, keys.length > 0 ? await deps.listPapers() : []);
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
