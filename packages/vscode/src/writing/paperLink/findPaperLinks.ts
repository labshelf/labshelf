// Finds the labshelf: links in a document and pairs each with the library paper its key names.
import * as vscode from "vscode";

import { findLabshelfLinks, papersByCiteKey, type LabshelfLink, type PaperRecord } from "@labshelf/core";
import type { CitationSession } from "../citations/index.js";

export interface PaperLink {
  readonly range: vscode.Range;
  readonly link: LabshelfLink;
  /** Absent when no paper of the library has the link's cite key. */
  readonly paper: PaperRecord | undefined;
}

/** The open library, as far as links need it: the papers and the logger. */
export interface LinkLibrary {
  session(): Pick<CitationSession, "listPapers" | "logger"> | undefined;
}

/** Returns no links when no library is open; reads the library only when the text holds a link. */
export async function findPaperLinks(library: LinkLibrary, document: vscode.TextDocument): Promise<PaperLink[]> {
  const session = library.session();
  if (!session) { return []; }
  const found = findLabshelfLinks(document.getText());
  if (found.length === 0) { return []; }
  const papers = papersByCiteKey(await session.listPapers());
  return found.map(({ start, end, link }) => ({
    range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
    link,
    paper: papers.get(link.citeKey),
  }));
}
