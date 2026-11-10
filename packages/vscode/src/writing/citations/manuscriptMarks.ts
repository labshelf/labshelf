// The marks of linked copies in a native manuscript, shared by the note links and the code links: computing them per document, the hover, the quick fixes and the Update and Show differences commands.
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import * as vscode from "vscode";

import type { ILogger, LatexRange, OriginState } from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { deriveVscodeRange } from "../../latex/index.js";
import { commandLink, createMarkHover, DiffDocuments } from "./linkMarks.js";

/** One linked copy of a document, at the line of its opening comment. */
export interface MarkedView {
  line: number;
  /** Column where the comment starts on its line. */
  commentStart: number;
  lineLength: number;
  /** Undefined when the source cannot be read: no mark. */
  state: OriginState | undefined;
}

/** What differs between the kinds of links: their names, how a document's copies are computed, updated and compared. */
export interface MarkKind<V extends MarkedView> {
  module: string;
  collection: string;
  /** The diagnostic source, which the quick fixes match. */
  source: string;
  diffScheme: string;
  updateTitle: string;
  updateCommand: string;
  diffCommand: string;
  describe(view: V): string | undefined;
  /** The computation of the document's copies; undefined when the document holds none of this kind. */
  prepare(document: vscode.TextDocument): (() => Promise<V[]>) | undefined;
  /** The edit that updates a stale copy; undefined for any other state. */
  buildUpdate(document: vscode.TextDocument, view: V): Promise<{ range: LatexRange; text: string } | undefined>;
  showDiff(diffs: DiffDocuments, document: vscode.TextDocument, view: V): Promise<void>;
}

const canUpdate = (view: MarkedView): boolean => view.state === "stale";
const canDiff = (view: MarkedView): boolean => view.state === "stale" || view.state === "diverged" || view.state === "both";

function markOf<V extends MarkedView>(kind: MarkKind<V>, view: V): vscode.Diagnostic | undefined {
  const message = kind.describe(view);
  if (!message || !view.state) { return undefined; }
  const severity = view.state === "stale" ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning;
  const mark = new vscode.Diagnostic(new vscode.Range(view.line, view.commentStart, view.line, view.lineLength), message, severity);
  mark.source = kind.source;
  mark.code = view.state;
  return mark;
}

export class ManuscriptMarks<V extends MarkedView> implements vscode.Disposable {
  private readonly marks: vscode.DiagnosticCollection;
  private readonly views = new Map<string, V[]>();
  private readonly runs = new Map<string, number>();
  readonly diffs: DiffDocuments;

  constructor(private readonly kind: MarkKind<V>, private readonly logger: ILogger) {
    this.marks = vscode.languages.createDiagnosticCollection(kind.collection);
    this.diffs = new DiffDocuments(kind.diffScheme);
  }

  dispose(): void { this.marks.dispose(); }

  /** Computes the copies of the document and shows their marks; a later computation wins over an earlier one still running. */
  async refresh(document: vscode.TextDocument): Promise<V[]> {
    const compute = this.kind.prepare(document);
    if (!compute) { return []; }
    const key = document.uri.toString();
    const run = (this.runs.get(key) ?? 0) + 1;
    this.runs.set(key, run);
    try {
      const views = await compute();
      if (this.runs.get(key) !== run) { return this.views.get(key) ?? []; }
      this.views.set(key, views);
      this.marks.set(document.uri, views.flatMap((view) => markOf(this.kind, view) ?? []));
      return views;
    } catch (error) {
      await this.logger.error(this.kind.module, error, { action: "refresh" });
      return [];
    }
  }

  refreshOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments ?? []) { void this.refresh(document); }
  }

  forget(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.views.delete(key);
    this.runs.delete(key);
    this.marks.delete(document.uri);
    this.diffs.forget(document.uri);
  }

  viewAtLine(document: vscode.TextDocument, line: number): V | undefined {
    return (this.views.get(document.uri.toString()) ?? []).find((candidate) => candidate.line === line);
  }

  /** The copy at the line after a fresh computation. */
  private async viewAt(uriArg: vscode.Uri | string, line: number): Promise<{ document: vscode.TextDocument; view: V } | undefined> {
    const document = await vscode.workspace.openTextDocument(typeof uriArg === "string" ? vscode.Uri.parse(uriArg) : uriArg);
    const view = (await this.refresh(document)).find((candidate) => candidate.line === line);
    return view ? { document, view } : undefined;
  }

  async update(uriArg: vscode.Uri | string, line: number): Promise<void> {
    const found = await this.viewAt(uriArg, line);
    // Anything but stale (or a copy that went fresh since) writes nothing.
    const update = found && await this.kind.buildUpdate(found.document, found.view);
    if (!found || !update) { return; }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(found.document.uri, deriveVscodeRange(update.range), update.text);
    await vscode.workspace.applyEdit(edit);
    await this.refresh(found.document);
  }

  async showDiff(uriArg: vscode.Uri | string, line: number): Promise<void> {
    const found = await this.viewAt(uriArg, line);
    if (found && canDiff(found.view)) { await this.kind.showDiff(this.diffs, found.document, found.view); }
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const view = this.viewAtLine(document, position.line);
    const sentence = view && this.kind.describe(view);
    if (!view || !sentence || position.character < view.commentStart) { return undefined; }
    const { line } = view;
    const { updateTitle, updateCommand, diffCommand } = this.kind;
    const actions: string[] = [];
    if (canUpdate(view)) { actions.push(commandLink(updateTitle, updateCommand, document, line)); }
    if (canDiff(view)) { actions.push(commandLink("Show differences", diffCommand, document, line)); }
    return createMarkHover(sentence, actions, [updateCommand, diffCommand], new vscode.Range(line, view.commentStart, line, view.lineLength));
  }

  async provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    const { updateTitle, updateCommand, diffCommand } = this.kind;
    for (const mark of context.diagnostics) {
      if (mark.source !== this.kind.source) { continue; }
      const line = mark.range.start.line;
      const view = this.viewAtLine(document, line);
      if (!view || view.state !== mark.code) { continue; }
      const update = canUpdate(view) ? await this.kind.buildUpdate(document, view) : undefined;
      if (update) {
        const action = new vscode.CodeAction(updateTitle, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [mark];
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, deriveVscodeRange(update.range), update.text);
        // Runs after the edit: the copy is fresh by then, so it only recomputes the marks.
        action.command = { command: updateCommand, title: updateTitle, arguments: [document.uri, line] };
        actions.push(action);
      }
      if (canDiff(view)) {
        const action = new vscode.CodeAction("Show differences", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [mark];
        action.command = { command: diffCommand, title: "Show differences", arguments: [document.uri, line] };
        actions.push(action);
      }
    }
    return actions;
  }
}

const SOURCES = [
  { scheme: "file", pattern: "**/*.tex" },
  { scheme: "file", pattern: "**/*.typ" },
];

/**
 * Registers the marks with their commands, hover, quick fixes and the document events; computes the visible documents' marks.
 * @param isSource whether a saved file is one the copies come from, which refreshes every open manuscript
 */
export function registerManuscriptMarks<V extends MarkedView>(
  context: vscode.ExtensionContext, marks: ManuscriptMarks<V>, kind: MarkKind<V>, logger: ILogger, isSource: (document: vscode.TextDocument) => boolean,
): void {
  const run = (id: string, action: () => Promise<void>): Promise<void> => runSafely(logger, id, action);
  context.subscriptions.push(
    marks,
    vscode.commands.registerCommand(kind.updateCommand, (uri: vscode.Uri | string, line: number) => run(kind.updateCommand, () => marks.update(uri, line))),
    vscode.commands.registerCommand(kind.diffCommand, (uri: vscode.Uri | string, line: number) => run(kind.diffCommand, () => marks.showDiff(uri, line))),
    marks.diffs.register(),
    vscode.languages.registerHoverProvider(SOURCES, { provideHover: (document, position) => marks.provideHover(document, position) }),
    vscode.languages.registerCodeActionsProvider(SOURCES, { provideCodeActions: (document, range, ctx) => marks.provideCodeActions(document, range, ctx) },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.workspace.onDidOpenTextDocument((document) => { void marks.refresh(document); }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isSource(document)) { marks.refreshOpenDocuments(); } else { void marks.refresh(document); }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => marks.forget(document)),
  );
  for (const editor of vscode.window.visibleTextEditors ?? []) { void marks.refresh(editor.document); }
}
