// Shows the library paper behind a cited key when the cursor rests on it.
import * as vscode from "vscode";

import { citedKeys, quotedHighlights, type ChecklistSection, type QuotedHighlight } from "@labshelf/core";
import type { CitationSession, CitationWorkspace } from "../citationWorkspace.js";
import { citingProject } from "../citationWorkspace.js";
import type { ReadyProject } from "../../mainDocument.js";
import { citationHoverContent } from "./citationHoverContent.js";

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
    const project = citingProject(this.workspace.projects, document.uri.fsPath);
    const session = this.workspace.session();
    if (!project || !session) { return undefined; }
    const offset = document.offsetAt(position);
    const cited = citedKeys(project.settings.format, document.getText())
      .find((candidate) => candidate.start <= offset && offset <= candidate.end);
    if (!cited) { return undefined; }
    const paper = (await session.listPapers()).find((candidate) => candidate.citeKey === cited.key);
    if (!paper) { return undefined; }
    const [highlights, others] = await Promise.all([
      optional<QuotedHighlight[]>(session, "hover-highlights", [], async () => quotedHighlights(await session.highlightsOf(paper.id), HIGHLIGHTS_SHOWN)),
      otherSections(session, project, cited.key, document.uri.fsPath, position.line),
    ]);
    const range = new vscode.Range(document.positionAt(cited.start), document.positionAt(cited.end));
    return new vscode.Hover(citationHoverContent({ paper, highlights, otherSections: others }), range);
  }
}
