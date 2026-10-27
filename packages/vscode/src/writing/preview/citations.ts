// Answers the preview reader's citation requests: which library papers a link or text cites, what the card shows about them and opening one.
import * as vscode from "vscode";

import {
  derivePapersByCiteKey, deriveCitationEntries, findCiteKeysAt, findCiteKeyOccurrences, findSourcePosition, listQuotedHighlights,
  createBibliographyCardEntry, parseBibEntries,
  type Annotation, type CitationBibEntry, type CitationDetails, type CitationEntry, type CitationQuery, type CitingCommand, type ILogger,
  type PagePoint, type PaperRecord, type PathOps, type ProjectFormat, type SourceLine, type TypstCitation,
} from "@labshelf/core";
import { listUserBibliographyFiles } from "./citationFixes.js";
import { PREVIEW_LOG_MODULE } from "./panel.js";
import type { SynctexFinder } from "./synctex.js";

/** What the preview's citation answers need from the project and the library. */
export interface PreviewCitationDeps {
  logger: ILogger;
  projectFolder: string;
  paths: PathOps;
  format: ProjectFormat;
  listPapers: () => Promise<PaperRecord[]>;
  /** Where the Typst build behind the shown PDF placed its citations. */
  typstCites: () => readonly TypstCitation[];
  synctex: () => Promise<SynctexFinder>;
  highlightsOf: (paperId: string) => Promise<Annotation[]>;
}

/** The text of a file as the user sees it: the open document's, saved or not. */
async function currentText(file: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === file);
  return open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)));
}

/** A source line with the file it belongs to. */
interface LocatedSourceLine extends SourceLine {
  file: string;
}

/** `undefined` when the project has no SyncTeX data or nothing of the source lies at the point. */
export async function findSourceLine(synctex: () => Promise<SynctexFinder>, point: PagePoint): Promise<LocatedSourceLine | undefined> {
  const lookup = await synctex();
  if (lookup.status !== "found") { return undefined; }
  const source = findSourcePosition(lookup.index, point);
  return source ? { file: source.file, text: await currentText(source.file), line: source.line } : undefined;
}

/** Where a key is cited and the page its `[p.~N]` argument names, if any. */
interface CitedCommand {
  command: CitingCommand;
  page?: number;
}

/** The first command on the line that cites each key; a key not cited on the line has no site. */
function listCitingSites(paths: PathOps, format: ProjectFormat, projectFolder: string, source: LocatedSourceLine, keys: readonly string[]): Map<string, CitedCommand> {
  const file = paths.relative(projectFolder, source.file).split(paths.sep).join("/");
  const sites = new Map<string, CitedCommand>();
  for (const cited of findCiteKeyOccurrences(format, source.text)) {
    const line = source.text.slice(0, cited.start).split("\n").length;
    if (line !== source.line || !keys.includes(cited.key) || sites.has(cited.key)) { continue; }
    sites.set(cited.key, { command: { file, line, text: cited.command }, ...(cited.page !== undefined ? { page: cited.page } : {}) });
  }
  return sites;
}

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

async function reportWarning(deps: Pick<PreviewCitationDeps, "logger" | "projectFolder">, message: string, error: unknown, context: object = {}): Promise<void> {
  await deps.logger.log("WARN", PREVIEW_LOG_MODULE, message, { projectFolder: deps.projectFolder, ...context, error: String(error) });
}

/** Highlights per paper, cited page first. A part that cannot be read is logged and left out, so the card still answers. */
async function highlightsByPaper(deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[], sites: ReadonlyMap<string, CitedCommand>) {
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

async function readCardDetails(
  deps: CardDeps, keys: readonly string[], papers: readonly PaperRecord[], sites: ReadonlyMap<string, CitedCommand>,
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
    const sites = deps.format === "latex" ? await citingSitesAt(deps, keys, () => locate(areaCenter(query.area))) : new Map<string, CitedCommand>();
    return deriveCitationEntries(keys, papers, await readCardDetails(deps, keys, papers, sites));
  } catch (error) {
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Citation lookup failed", { projectFolder: deps.projectFolder, page: query.area.page, error: String(error) });
    return [];
  }
}

/** The citing commands are extra: a source that cannot be read is logged and the card answers without them. */
async function citingSitesAt(
  deps: PreviewCitationDeps, keys: readonly string[], locate: () => Promise<LocatedSourceLine | undefined>,
): Promise<Map<string, CitedCommand>> {
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
