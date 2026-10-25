// Registers the labshelf: link provider, its hover and the URI handler that open papers in the reader.
import * as vscode from "vscode";

import {
  derivePapersByCiteKey,
  parsePaperLink,
  SHARE_IMPORT_PATH,
  findPaperLinkMatches,
  type ParsedPaperLink,
  type PaperRecord,
} from "@labshelf/core";
import { IMPORT_SHARE_COMMAND } from "../share/index.js";
import { createPaperHover, type CitationSession } from "./citations/index.js";

interface PaperLink {
  readonly range: vscode.Range;
  readonly link: ParsedPaperLink;
  /** Absent when no paper of the library has the link's cite key. */
  readonly paper: PaperRecord | undefined;
}

/** The open library, as far as links need it: the papers and the logger. */
export interface PaperLinkLibrary {
  session(): Pick<CitationSession, "listPapers" | "logger"> | undefined;
}

/** Returns no links when no library is open; reads the library only when the text holds a link. */
async function findPaperLinks(library: PaperLinkLibrary, document: vscode.TextDocument): Promise<PaperLink[]> {
  const session = library.session();
  if (!session) { return []; }
  const found = findPaperLinkMatches(document.getText());
  if (found.length === 0) { return []; }
  const papers = derivePapersByCiteKey(await session.listPapers());
  return found.map(({ start, end, link }) => ({
    range: new vscode.Range(document.positionAt(start), document.positionAt(end)),
    link,
    paper: papers.get(link.citeKey),
  }));
}

export class PaperLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly library: PaperLinkLibrary) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const links = await findPaperLinks(this.library, document);
    return links.flatMap(({ range, link, paper }) => {
      if (!paper) { return []; }
      const args = link.page === undefined ? [paper.id] : [paper.id, link.page];
      const target = vscode.Uri.parse(`command:labshelf.openPdfViewer?${encodeURIComponent(JSON.stringify(args))}`);
      const documentLink = new vscode.DocumentLink(range, target);
      documentLink.tooltip = link.page === undefined ? "Open in LabShelf reader" : `Open in LabShelf reader, page ${link.page}`;
      return [documentLink];
    });
  }
}

export class PaperLinkHoverProvider implements vscode.HoverProvider {
  constructor(private readonly library: PaperLinkLibrary) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const found = (await findPaperLinks(this.library, document)).find(({ range }) => range.contains(position));
    if (!found) { return undefined; }
    const contents = found.paper
      ? createPaperHover(found.paper)
      : new vscode.MarkdownString(`No paper in the library has key \`${found.link.citeKey}\`.`);
    return new vscode.Hover(contents, found.range);
  }
}

const LOG_MODULE = "LabshelfLinks";

export class LabshelfUriHandler implements vscode.UriHandler {
  constructor(private readonly library: PaperLinkLibrary) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    // CONTRACT: documents/contracts/share-link.md#open-in-labshelf
    if (uri.path === SHARE_IMPORT_PATH) {
      await vscode.commands.executeCommand(IMPORT_SHARE_COMMAND, new URLSearchParams(uri.query).get("link") ?? undefined);
      return;
    }
    const session = this.library.session();
    if (!session) {
      await vscode.window.showWarningMessage("Open a LabShelf library before following a labshelf: link.");
      return;
    }
    const text = uri.path === "/open" ? new URLSearchParams(uri.query).get("link") : null;
    const link = text === null ? undefined : parsePaperLink(text);
    if (!link) {
      await session.logger.log("WARN", LOG_MODULE, "Ignored a URI that is not a labshelf: link", { path: uri.path, query: uri.query });
      await vscode.window.showWarningMessage("LabShelf could not read that link. Expected labshelf:<cite key>[#p<page>].");
      return;
    }
    try {
      // The key comes from outside, and resolvePaper opens a quick pick for ids it does not know.
      const paper = derivePapersByCiteKey(await session.listPapers()).get(link.citeKey);
      if (!paper) {
        await session.logger.log("WARN", LOG_MODULE, "Link names a key that no paper has", { citeKey: link.citeKey });
        await vscode.window.showWarningMessage(`No paper in the library has the key "${link.citeKey}".`);
        return;
      }
      const args = link.page === undefined ? [paper.id] : [paper.id, link.page];
      await vscode.commands.executeCommand("labshelf.openPdfViewer", ...args);
      await session.logger.log("INFO", LOG_MODULE, "Opened paper from a labshelf: URI", { paperId: paper.id, page: link.page });
    } catch (error) {
      await session.logger.error(LOG_MODULE, error, { citeKey: link.citeKey });
    }
  }
}

const ANY_DOCUMENT = [{ scheme: "file" }, { scheme: "untitled" }];

export function registerPaperLinks(context: vscode.ExtensionContext, library: PaperLinkLibrary): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(ANY_DOCUMENT, new PaperLinkProvider(library)),
    vscode.languages.registerHoverProvider(ANY_DOCUMENT, new PaperLinkHoverProvider(library)),
    vscode.window.registerUriHandler(new LabshelfUriHandler(library)),
  );
}
