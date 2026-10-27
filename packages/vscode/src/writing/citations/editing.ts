// Editor commands for the active LaTeX or Typst file: bold and italic, symbol, table and image inserts, and labshelf: paper links.
import * as vscode from "vscode";

import {
  IMAGE_EXTENSIONS, IMAGE_FOLDER, MATH_SYMBOLS, MAX_TABLE_SIDE, SHARE_IMPORT_PATH,
  createImageSnippet, createTableSnippet, deriveImageBaseFolder, derivePapersByCiteKey, deriveSelectionWrap, deriveSymbolSource,
  findFreeImageName, findPaperLinkMatches, isInside, parsePaperLink, parseTableSize,
  type ILogger, type ParsedPaperLink, type PaperRecord, type WrapKind,
} from "@labshelf/core";
import { createPaperHover, type CitationSession } from "./index.js";
import { findOwningProject, type ProjectFinder, type ReadyProject, type WritingHost } from "../projects/index.js";
import { IMPORT_SHARE_COMMAND } from "../../share/index.js";

// ---- Language of the active editor

type WritingLanguage = "latex" | "typst";

function readWritingLanguage(editor: vscode.TextEditor | undefined): WritingLanguage | undefined {
  const language = editor?.document.languageId;
  return language === "latex" || language === "typst" ? language : undefined;
}

// ---- Bold and italic

const COMMANDS: Record<WrapKind, string> = { bold: "labshelf.writing.bold", italic: "labshelf.writing.italic" };

interface EditorActionDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
}

async function wrapActiveSelections(deps: EditorActionDeps, style: WrapKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const language = readWritingLanguage(editor);
  if (!editor || !language) { return; }
  const { document } = editor;
  const ordered = [...editor.selections].sort((a, b) => document.offsetAt(a.start) - document.offsetAt(b.start));
  // Offsets are read before the edit, because the document changes under the selections afterwards.
  const spans = ordered.map((selection) => ({ start: document.offsetAt(selection.start), end: document.offsetAt(selection.end) }));
  const wraps = ordered.map((selection) => deriveSelectionWrap(language, style, document.getText(selection)));
  const applied = await editor.edit((builder) => {
    ordered.forEach((selection, index) => builder.replace(selection, wraps[index]!.text));
  });
  if (!applied) {
    await deps.host.current()?.logger.log("WARN", "writing/editorActions", "Editor rejected the wrap edit", { style, language });
    return;
  }
  // The edits shift every later selection by the length change of the earlier ones.
  let shift = 0;
  editor.selections = spans.map((span, index) => {
    const { text, cursor } = wraps[index]!;
    const start = span.start + shift;
    shift += text.length - (span.end - span.start);
    return cursor === undefined
      ? new vscode.Selection(document.positionAt(start), document.positionAt(start + text.length))
      : new vscode.Selection(document.positionAt(start + cursor), document.positionAt(start + cursor));
  });
}

export function registerEditorActions(deps: EditorActionDeps): void {
  for (const style of Object.keys(COMMANDS) as WrapKind[]) {
    deps.context.subscriptions.push(vscode.commands.registerCommand(COMMANDS[style], () => wrapActiveSelections(deps, style)));
  }
}

// ---- Insert symbol, table and image

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/** Copies into the project's images folder under a free name; an existing file is never overwritten. */
async function copyIntoProject(projects: ProjectFinder, project: ReadyProject, source: string): Promise<string> {
  const { paths } = projects;
  const folder = paths.join(project.folder, IMAGE_FOLDER);
  const target = await findFreeImageName(paths, folder, paths.basename(source), (path) => exists(vscode.Uri.file(path)));
  await vscode.workspace.fs.copy(vscode.Uri.file(source), vscode.Uri.file(target), { overwrite: false });
  return target;
}

async function insertImage(editor: vscode.TextEditor, language: WritingLanguage, projects: ProjectFinder, logger: ILogger | undefined): Promise<void> {
  const documentPath = editor.document.uri.fsPath;
  const project = findOwningProject(projects, documentPath);
  if (!project) { return; }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(project.folder),
    filters: { Images: IMAGE_EXTENSIONS[language] },
    openLabel: "Insert Image",
  });
  const source = picked?.[0]?.fsPath;
  if (!source) { return; }
  const { paths } = projects;
  let image = source;
  if (!isInside(paths, project.folder, source)) {
    try {
      image = await copyIntoProject(projects, project, source);
      await logger?.log("INFO", "writing/editorActions", "Copied an image into the project", { source, image });
    } catch (error) {
      await logger?.log("ERROR", "writing/editorActions", "Could not copy the image into the project", { source, folder: project.folder, error: String(error) });
      void vscode.window.showErrorMessage(`Could not copy the image into the project: ${String(error)}`);
      return;
    }
  }
  const relative = paths.relative(deriveImageBaseFolder(language, project.folder, project.main, documentPath, paths), image).split(paths.sep).join("/");
  await editor.insertSnippet(new vscode.SnippetString(createImageSnippet(language, relative)));
}

interface InsertActionDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: ProjectFinder;
}

interface SymbolItem extends vscode.QuickPickItem {
  source?: string;
}

function symbolItems(language: WritingLanguage): SymbolItem[] {
  return MATH_SYMBOLS.flatMap((symbol, index) => {
    const source = deriveSymbolSource(symbol, language);
    const item: SymbolItem = { label: symbol.glyph, description: source, source };
    const startsCategory = MATH_SYMBOLS[index - 1]?.category !== symbol.category;
    return startsCategory ? [{ label: symbol.category, kind: vscode.QuickPickItemKind.Separator }, item] : [item];
  });
}

async function insertSymbol(editor: vscode.TextEditor, language: WritingLanguage): Promise<void> {
  const picked = await vscode.window.showQuickPick(symbolItems(language), { title: "Insert Symbol", placeHolder: "Search by name, e.g. alpha or arrow", matchOnDescription: true });
  if (!picked?.source) { return; }
  await editor.insertSnippet(new vscode.SnippetString().appendText(picked.source));
}

async function insertTable(editor: vscode.TextEditor, language: WritingLanguage): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "Insert Table",
    prompt: "Columns x rows",
    value: "3x3",
    validateInput: (value) => parseTableSize(value) ? undefined : `Enter columns x rows, each from 1 to ${MAX_TABLE_SIDE}, e.g. 3x2`,
  });
  const size = input === undefined ? undefined : parseTableSize(input);
  if (!size) { return; }
  await editor.insertSnippet(new vscode.SnippetString(createTableSnippet(language, size)));
}

export function registerInsertActions(deps: InsertActionDeps): void {
  const actions: Record<string, (editor: vscode.TextEditor, language: WritingLanguage) => Promise<void>> = {
    "labshelf.writing.insertSymbol": insertSymbol,
    "labshelf.writing.insertTable": insertTable,
    "labshelf.writing.insertImage": (editor, language) => insertImage(editor, language, deps.projects, deps.host.current()?.logger),
  };
  for (const [command, action] of Object.entries(actions)) {
    deps.context.subscriptions.push(vscode.commands.registerCommand(command, () => {
      const editor = vscode.window.activeTextEditor;
      const language = readWritingLanguage(editor);
      return editor && language ? action(editor, language) : undefined;
    }));
  }
}

// ---- labshelf: links

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

export class PaperLinkHandler implements vscode.UriHandler {
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
    vscode.window.registerUriHandler(new PaperLinkHandler(library)),
  );
}
