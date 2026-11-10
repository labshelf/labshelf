// "Insert Code…" from a manuscript and "Insert into Manuscript" from a code file: a linked listing at the cursor of the native or LabShelf editor.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";

import {
  CODE_FILE_GLOB,
  buildCodeInsert, deriveCodeLanguage, deriveListingStyle, excerptFromLines, findEnclosingSymbol, listCodeSymbols, listProjectFiles, readCodeExcerpt,
  type CodeExcerpt, type CodeSymbol, type ListingStyle,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { createCodeLinkSource, isCodeFile } from "../codeSource.js";
import { findCitingProject } from "./backlinks.js";
import { deriveBlockText, insertBlock } from "./linkMarks.js";
import type { CodeLinkDeps } from "./codeLinks.js";
import type { SourceView } from "../activeSource.js";
import type { ReadyProject } from "../projects/index.js";

const INSERT_COMMAND = "labshelf.writing.insertCode";
const COPY_COMMAND = "labshelf.writing.copyCodeToManuscript";
const LABSHELF_EDITOR = "labshelf.sourceEditor";
const EXCLUDE = "**/{node_modules,.git,.venv,venv,__pycache__,.labshelf}/**";
const MAX_FILES = 5000;
const LISTINGS_HINT = "Add \\usepackage{listings} to the preamble so the listing compiles.";

/** A manuscript to insert into: a LabShelf editor (with its updates) or a native document. */
interface Manuscript {
  uri: vscode.Uri;
  project: ReadyProject;
  format: "latex" | "typst";
  view?: SourceView;
}


class CodeInsert {
  /** The last focused .tex or .typ source view, native or LabShelf. */
  private last: SourceView | undefined;

  constructor(private readonly deps: CodeLinkDeps, private readonly inserted: (document: vscode.TextDocument) => void) {
    this.remember(deps.activeSource.current());
  }

  remember(view: SourceView | undefined): void {
    if (view && this.manuscriptOf(view.uri, view)) { this.last = view; }
  }

  private manuscriptOf(uri: vscode.Uri, view?: SourceView): Manuscript | undefined {
    const project = uri.scheme === "file" ? findCitingProject(this.deps.projects, uri.fsPath) : undefined;
    if (!project) { return undefined; }
    return { uri, project, format: project.settings.format === "typst" ? "typst" : "latex", ...(view?.updates ? { view } : {}) };
  }

  private relativePath(project: ReadyProject, file: string): string {
    const { paths } = this.deps.projects;
    return paths.relative(project.folder, file).split(paths.sep).join("/");
  }

  // ---- Insert Code… from a manuscript

  async insertCode(): Promise<void> {
    const current = this.deps.activeSource.current();
    const manuscript = current && this.manuscriptOf(current.uri, current);
    if (!manuscript) {
      await vscode.window.showInformationMessage("Open a manuscript of a writing project first");
      return;
    }
    const files = (await vscode.workspace.findFiles(CODE_FILE_GLOB, EXCLUDE, MAX_FILES)).filter((uri) => uri.scheme === "file" && isCodeFile(uri.fsPath));
    if (files.length === 0) {
      await vscode.window.showInformationMessage("No code files found in the workspace.");
      return;
    }
    const entries = files.map((uri) => ({ label: this.relativePath(manuscript.project, uri.fsPath), iconPath: vscode.ThemeIcon.File, resourceUri: uri }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const file = await vscode.window.showQuickPick(entries, { title: "Insert code", placeHolder: "Search code files" });
    if (!file) { return; }
    const text = await createCodeLinkSource(this.deps.projects.paths, manuscript.project.folder).read(file.label);
    if (text === undefined) { return; }
    const excerpt = await pickExcerpt(file.label, text);
    if (excerpt) { await this.insertInto(manuscript, excerpt); }
  }

  // ---- Insert into Manuscript from a code file

  async copyToManuscript(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file" || !isCodeFile(editor.document.uri.fsPath)) {
      await vscode.window.showInformationMessage("Open a code file LabShelf knows (.py, .R, .jl…) first");
      return;
    }
    const manuscript = await this.findTarget();
    if (!manuscript) { return; }
    const { document, selection } = editor;
    const path = this.relativePath(manuscript.project, document.uri.fsPath);
    const text = document.getText();
    let excerpt: CodeExcerpt;
    if (!selection.isEmpty) {
      // A selection that ends at the start of a line does not take that line.
      const end = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line;
      excerpt = excerptFromLines(path, text, selection.start.line, end);
    } else {
      const language = deriveCodeLanguage(path)?.symbols;
      const symbol = language && findEnclosingSymbol(listCodeSymbols(language, text), selection.active.line);
      excerpt = symbol ? excerptFromLines(path, text, symbol.startLine, symbol.endLine) : readCodeExcerpt(path, text, { kind: "file" })!;
    }
    await this.insertInto(manuscript, excerpt);
  }

  /** The last focused manuscript while it is still open, else one the user picks among the open ones. */
  private async findTarget(): Promise<Manuscript | undefined> {
    const last = this.last;
    const alive = last && (last.updates
      ? this.deps.activeSource.listOpen().includes(last)
      : vscode.workspace.textDocuments.some((document) => document.uri.toString() === last.uri.toString()));
    const remembered = alive ? this.manuscriptOf(last.uri, last) : undefined;
    if (remembered) { return remembered; }
    const open = new Map<string, Manuscript>();
    for (const document of vscode.workspace.textDocuments) {
      const manuscript = /\.(tex|typ)$/i.test(document.uri.fsPath) ? this.manuscriptOf(document.uri) : undefined;
      if (manuscript) { open.set(document.uri.toString(), manuscript); }
    }
    // A file open in a LabShelf editor is inserted into through it.
    for (const view of this.deps.activeSource.listOpen()) {
      const manuscript = this.manuscriptOf(view.uri, view);
      if (manuscript) { open.set(view.uri.toString(), manuscript); }
    }
    if (open.size === 0) {
      await vscode.window.showInformationMessage("Open a manuscript of a writing project first");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick([...open.values()].map((manuscript) => ({
      label: vscode.workspace.asRelativePath(manuscript.uri), manuscript,
    })), { title: "Insert into manuscript", placeHolder: "Pick the manuscript" });
    return picked?.manuscript;
  }

  // ---- The insert

  private async insertInto(manuscript: Manuscript, excerpt: CodeExcerpt): Promise<void> {
    const document = await vscode.workspace.openTextDocument(manuscript.uri);
    const { style, needsPackage } = await this.listingStyle(manuscript, document.getText());
    let block: string;
    try {
      block = await buildCodeInsert(manuscript.format, style, excerpt);
    } catch (error) {
      await vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    const { view } = manuscript;
    if (view?.updates) {
      // The LabShelf editor inserts at its own cursor; its line tells whether the block needs a line of its own.
      const lineText = document.lineAt(Math.min(document.lineCount - 1, Math.max(0, view.line() - 1))).text;
      view.updates.insertText(deriveBlockText(block, lineText, lineText));
      await revealLabShelfEditor(manuscript.uri);
      view.reveal(view.line());
    } else {
      const visible = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === manuscript.uri.toString());
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: false, ...(visible?.viewColumn ? { viewColumn: visible.viewColumn } : {}) });
      if (!(await insertBlock(editor, block))) { return; }
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.inserted(document);
    }
    if (needsPackage) { void vscode.window.showInformationMessage(LISTINGS_HINT); }
  }

  /** minted when the manuscript or a project main file loads it, else listings; Typst has no style. */
  private async listingStyle(manuscript: Manuscript, text: string): Promise<{ style: ListingStyle; needsPackage: boolean }> {
    if (manuscript.format === "typst") { return { style: "listings", needsPackage: false }; }
    const { fs, paths } = this.deps.projects;
    const texts = [text];
    try {
      for (const file of (await listProjectFiles({ fs, paths }, manuscript.project.folder)).filter((each) => each.endsWith(".tex"))) {
        const content = await fs.readText(paths.join(manuscript.project.folder, file));
        if (content.includes("\\documentclass")) { texts.push(content); }
      }
    } catch (error) {
      await this.deps.logger.error("writing/codeInsert", error, { action: "read-preambles" });
    }
    return deriveListingStyle(texts);
  }
}

/** Whole file, or one of its definitions when the language has them; undefined when the user cancels. */
async function pickExcerpt(path: string, text: string): Promise<CodeExcerpt | undefined> {
  const whole = (): CodeExcerpt => readCodeExcerpt(path, text, { kind: "file" })!;
  const language = deriveCodeLanguage(path)?.symbols;
  const symbols = language ? listCodeSymbols(language, text) : [];
  if (symbols.length === 0) { return whole(); }
  const entries: (vscode.QuickPickItem & { symbol?: CodeSymbol })[] = [
    { label: "Whole file", iconPath: vscode.ThemeIcon.File },
    ...symbols.map((symbol) => ({
      label: symbol.name, description: `lines ${symbol.startLine + 1}–${symbol.endLine + 1}`,
      iconPath: new vscode.ThemeIcon(symbol.kind === "class" ? "symbol-class" : "symbol-function"), symbol,
    })),
  ];
  const picked = await vscode.window.showQuickPick(entries, { title: `Insert code from ${path}`, placeHolder: "Whole file or a definition" });
  if (!picked) { return undefined; }
  return picked.symbol ? excerptFromLines(path, text, picked.symbol.startLine, picked.symbol.endLine) : whole();
}

/** Brings the LabShelf editor of the file to the front in the column it is open in. */
async function revealLabShelfEditor(uri: vscode.Uri): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    const tab = group.tabs.find((each) => each.input instanceof vscode.TabInputCustom && each.input.viewType === LABSHELF_EDITOR && each.input.uri.toString() === uri.toString());
    if (tab) {
      await vscode.commands.executeCommand("vscode.openWith", uri, LABSHELF_EDITOR, group.viewColumn);
      return;
    }
  }
}

/** Registers Insert Code… and Insert into Manuscript; `inserted` refreshes the marks of a native manuscript after an insert. */
export function registerCodeInsert(context: vscode.ExtensionContext, deps: CodeLinkDeps, inserted: (document: vscode.TextDocument) => void): void {
  const insert = new CodeInsert(deps, inserted);
  const run = (id: string, action: () => Promise<void>): Promise<void> => runSafely(deps.logger, id, action);
  context.subscriptions.push(
    deps.activeSource.onDidChange((view) => insert.remember(view)),
    vscode.commands.registerCommand(INSERT_COMMAND, () => run(INSERT_COMMAND, () => insert.insertCode())),
    vscode.commands.registerCommand(COPY_COMMAND, () => run(COPY_COMMAND, () => insert.copyToManuscript())),
  );
}
