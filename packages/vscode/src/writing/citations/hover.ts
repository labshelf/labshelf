// Shows the library paper behind a cited key or a labshelf: link when the cursor rests on it.
import * as vscode from "vscode";

import {
  findCiteKeyOccurrences,
  listQuotedHighlights,
  type ChecklistSection,
  type PaperRecord,
  type QuotedHighlight,
} from "@labshelf/core";
import type { ReadyProject } from "../projects/index.js";
import { findCitingProject, type CitationSession, type CitationWorkspace } from "./backlinks.js";

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");

/** Authors and year on one line; empty when the paper has neither. */
function formatPaperByline(paper: PaperRecord): string {
  return [paper.authors?.join(", "), paper.year].filter((part) => part !== undefined && part !== "").join(" ");
}

/** Collapses whitespace and cuts at a word boundary within `max` characters, marking the cut with an ellipsis. */
function formatExcerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) { return flat; }
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}


// Opening the paper is the key's Ctrl+click link, whose tooltip shows under this hover.
export function createPaperHover(paper: PaperRecord): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${escapeMarkdown(paper.title)}**`);
  const byline = formatPaperByline(paper);
  if (byline) { markdown.appendMarkdown(`\n\n${escapeMarkdown(byline)}`); }
  if (paper.summary) { markdown.appendMarkdown(`\n\n${escapeMarkdown(paper.summary)}`); }
  return markdown;
}

const ABSTRACT_CHARS = 200;
const HIGHLIGHT_CHARS = 140;
const SECTIONS_SHOWN = 4;
const OPEN_PAPER_COMMAND = "labshelf.openPdfViewer";

interface CitationHoverData {
  paper: PaperRecord;
  highlights: readonly QuotedHighlight[];
  /** Sections that cite the key, without the one the hover is in. */
  otherSections: readonly ChecklistSection[];
}

function alsoCitedIn(sections: readonly ChecklistSection[]): string {
  const shown = sections.slice(0, SECTIONS_SHOWN).map((section) => `§ ${escapeMarkdown(section.title)}`);
  const more = sections.length - shown.length;
  return `Also cited in ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

function citationHoverContent({ paper, highlights, otherSections }: CitationHoverData): vscode.MarkdownString {
  const openArgs = encodeURIComponent(JSON.stringify([paper.id]));
  const blocks = [`**${escapeMarkdown(paper.title)}**`, `[Open paper](command:${OPEN_PAPER_COMMAND}?${openArgs})`];
  const byline = formatPaperByline(paper);
  if (byline) { blocks.push(escapeMarkdown(byline)); }
  if (paper.summary?.trim()) { blocks.push(escapeMarkdown(formatExcerpt(paper.summary, ABSTRACT_CHARS))); }
  if (highlights.length > 0) {
    blocks.push(highlights.map((quote) => `- ${escapeMarkdown(formatExcerpt(quote.text, HIGHLIGHT_CHARS))} (${escapeMarkdown(`p. ${quote.page}`)})`).join("\n"));
  }
  if (otherSections.length > 0) { blocks.push(alsoCitedIn(otherSections)); }
  const markdown = new vscode.MarkdownString(blocks.join("\n\n"));
  // Only the reader command may run from this hover; paper text is escaped, so it cannot add links.
  markdown.isTrusted = { enabledCommands: [OPEN_PAPER_COMMAND] };
  return markdown;
}

const MODULE = "writing/citations";
const HIGHLIGHTS_SHOWN = 3;

/** An unreadable highlight list or source index drops that part of the hover instead of the whole hover. */
async function optional<T>(session: CitationSession, action: string, fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    await session.logger.error(MODULE, error, { action });
    return fallback;
  }
}

async function otherSections(
  session: CitationSession, project: ReadyProject, key: string, file: string, line: number,
): Promise<ChecklistSection[]> {
  const sections = await optional(session, "hover-cite-sections", undefined, () => session.citeSections(project));
  const current = sections?.sectionAt(file, line);
  return (sections?.byKey.get(key) ?? []).filter((section) => section.id !== current?.id);
}

export class CitationHoverProvider implements vscode.HoverProvider {
  constructor(private readonly workspace: CitationWorkspace) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const project = findCitingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return undefined; }
    const offset = document.offsetAt(position);
    const cited = findCiteKeyOccurrences(project.settings.format, document.getText())
      .find((candidate) => candidate.start <= offset && offset <= candidate.end);
    if (!cited) { return undefined; }
    const paper = (await session.listPapers()).find((candidate) => candidate.citeKey === cited.key);
    if (!paper) { return undefined; }
    const [highlights, others] = await Promise.all([
      optional<QuotedHighlight[]>(session, "hover-highlights", [], async () => listQuotedHighlights(await session.highlightsOf(paper.id), HIGHLIGHTS_SHOWN)),
      otherSections(session, project, cited.key, document.uri.fsPath, position.line),
    ]);
    const range = new vscode.Range(document.positionAt(cited.start), document.positionAt(cited.end));
    return new vscode.Hover(citationHoverContent({ paper, highlights, otherSections: others }), range);
  }
}
