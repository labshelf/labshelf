// "Insert from note" for LaTeX manuscripts, and the state of each inserted copy: marks, hover, "Update from note" and "Show differences".
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import * as vscode from "vscode";

import {
  buildInsert, buildUpdate, deriveOriginHash, deriveOriginState, derivePapersByCiteKey, diffOrigin, findOriginCommentStart,
  listNoteInsertables, listProjectCiteKeys, readOriginLatex, scanOrigins,
  type ILogger, type ManuscriptOrigin, type NoteInsertable, type NoteInsertSource, type OriginState, type PaperRecord, type ProjectNotesStore,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { deriveVscodeRange } from "../../latex/index.js";
import { findCitingProject } from "./backlinks.js";
import type { ReadyProject, WritingProjects } from "../projects/index.js";

const MODULE = "writing/noteLinks";
const MARK_SOURCE = "LabShelf";
const COLLECTION = "LabShelf notes";
const DIFF_SCHEME = "labshelf-origin";
const INSERT_COMMAND = "labshelf.writing.insertFromNote";
const UPDATE_COMMAND = "labshelf.writing.updateFromNote";
const DIFF_COMMAND = "labshelf.writing.showNoteDiff";
const PAPER_NOTE = /^paper:(.+)\/notes\.qmd$/;
const NO_ITEMS = "No equations or outputs found in this project's notes or the cited papers' notes.";
const SOURCES = [
  { scheme: "file", pattern: "**/*.tex" },
  { scheme: "file", pattern: "**/*.typ" },
];

type Language = "latex" | "typst";

/** The open paper library as the note links need it; `undefined` while no library is open. */
interface NoteLinkLibrary {
  listPapers(): Promise<PaperRecord[]>;
  /** The whole notes.qmd text of the paper, null or undefined when it has none. */
  readNotesText(paperId: string): Promise<string | null | undefined>;
}

export interface NoteLinkDeps {
  projects: Pick<WritingProjects, "list" | "paths" | "fs">;
  notes: Pick<ProjectNotesStore, "list" | "read">;
  logger: ILogger;
  library: () => NoteLinkLibrary | undefined;
}

/** One origin comment of a document with its computed state. */
interface OriginView {
  origin: ManuscriptOrigin;
  state: OriginState;
  item?: NoteInsertable;
  manuscriptLatex: string;
  /** Column where the origin comment starts on its line. */
  commentStart: number;
  lineLength: number;
}

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");

function readLanguage(document: vscode.TextDocument): Language | undefined {
  const language = document.languageId;
  return language === "latex" || language === "typst" ? language : undefined;
}

/** The sentence a mark and its hover say about an origin; fresh copies have none. */
function describeState(view: OriginView): string | undefined {
  const { label, notePath } = view.origin;
  switch (view.state) {
    case "stale": return `${label}: the note changed since it was inserted. Update from note replaces this copy.`;
    case "diverged": return `${label}: edited here, so it differs from the note. LabShelf will not overwrite it.`;
    case "both": return `${label}: edited here and changed in the note. LabShelf will not overwrite it.`;
    case "missing": return `${label}: not found in ${notePath}. The note or its label was removed or renamed.`;
    default: return undefined;
  }
}

async function computeViews(language: Language, text: string, items: readonly NoteInsertable[]): Promise<OriginView[]> {
  const lines = text.split("\n");
  return Promise.all(scanOrigins(language, text).map(async (origin): Promise<OriginView> => {
    const manuscriptLatex = readOriginLatex(language, text, origin);
    const manuscriptHash = await deriveOriginHash(manuscriptLatex);
    const item = items.find((candidate) => candidate.notePath === origin.notePath && candidate.label === origin.label);
    const state = deriveOriginState(origin, manuscriptHash, item ? { hash: await deriveOriginHash(item.latex) } : undefined);
    const content = (lines[origin.line] ?? "").replace(/\r$/, "");
    const start = findOriginCommentStart(content);
    return { origin, state, manuscriptLatex, commentStart: start >= 0 ? start : 0, lineLength: content.length, ...(item ? { item } : {}) };
  }));
}

function markOf(document: vscode.TextDocument, view: OriginView): vscode.Diagnostic | undefined {
  const message = describeState(view);
  if (!message) { return undefined; }
  const { line } = view.origin;
  const severity = view.state === "stale" ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning;
  const mark = new vscode.Diagnostic(new vscode.Range(line, view.commentStart, line, view.lineLength), message, severity);
  mark.source = MARK_SOURCE;
  mark.code = view.state;
  return mark;
}

function commandLink(title: string, command: string, document: vscode.TextDocument, line: number): string {
  return `[${title}](command:${command}?${encodeURIComponent(JSON.stringify([document.uri.toString(), line]))})`;
}

/** The raw paper title of a note path in the picker, falling back to the paper id. */
function paperIdOf(notePath: string): string | undefined {
  return PAPER_NOTE.exec(notePath)?.[1];
}

async function guarded<T>(deps: NoteLinkDeps, fallback: T, action: string, read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    await deps.logger.error(MODULE, error, { action });
    return fallback;
  }
}

/** Where the equations and outputs of a project's notes and of its cited papers' notes are read from; a failed read logs and answers nothing. */
function createNoteInsertSource(deps: NoteLinkDeps, project: ReadyProject): NoteInsertSource {
  const id = project.settings.id;
  return {
    listProjectNotes: () => guarded(deps, [], "list-notes", () => deps.notes.list(id)),
    readProjectNote: (path) => guarded<string | undefined>(deps, undefined, "read-note", async () => (await deps.notes.read(id, path)) ?? undefined),
    listCitedPaperIds: () => guarded<string[]>(deps, [], "list-cited-papers", async () => {
      const library = deps.library();
      if (!library) { return []; }
      const keys = await listProjectCiteKeys({ fs: deps.projects.fs, paths: deps.projects.paths }, project.folder, project.settings.format);
      const byKey = derivePapersByCiteKey(await library.listPapers());
      const ids = new Set<string>();
      for (const key of keys) {
        const paper = byKey.get(key);
        if (paper) { ids.add(paper.id); }
      }
      return [...ids];
    }),
    readPaperNote: (paperId) => guarded<string | undefined>(deps, undefined, "read-paper-note", async () => (await deps.library()?.readNotesText(paperId)) ?? undefined),
  };
}

class NoteLinks {
  private readonly marks = vscode.languages.createDiagnosticCollection(COLLECTION);
  private readonly views = new Map<string, OriginView[]>();
  private readonly runs = new Map<string, number>();
  private readonly diffTexts = new Map<string, string>();
  private readonly diffKeys = new Map<string, string[]>();
  private diffCount = 0;

  constructor(private readonly deps: NoteLinkDeps) {}

  dispose(): void { this.marks.dispose(); }

  // ---- Notes as insertable sources

  private sourceOf(project: ReadyProject): NoteInsertSource {
    return createNoteInsertSource(this.deps, project);
  }

  // ---- State of the origins of a document

  /** Computes the origins of the document and shows their marks; a later computation wins over an earlier one still running. */
  async refresh(document: vscode.TextDocument): Promise<OriginView[]> {
    const language = readLanguage(document);
    const project = language && findCitingProject(this.deps.projects, document.uri.fsPath);
    if (!language || !project) { return []; }
    const key = document.uri.toString();
    const run = (this.runs.get(key) ?? 0) + 1;
    this.runs.set(key, run);
    try {
      const text = document.getText();
      const items = scanOrigins(language, text).length === 0 ? [] : await listNoteInsertables(this.sourceOf(project));
      const views = await computeViews(language, text, items);
      if (this.runs.get(key) !== run) { return this.views.get(key) ?? []; }
      this.views.set(key, views);
      const marks = views.map((view) => markOf(document, view)).filter((mark): mark is vscode.Diagnostic => mark !== undefined);
      this.marks.set(document.uri, marks);
      return views;
    } catch (error) {
      await this.deps.logger.error(MODULE, error, { action: "refresh" });
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
    for (const diff of this.diffKeys.get(key) ?? []) { this.diffTexts.delete(diff); }
    this.diffKeys.delete(key);
  }

  viewsOf(document: vscode.TextDocument): OriginView[] {
    return this.views.get(document.uri.toString()) ?? [];
  }

  // ---- Insert

  async insertFromNote(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const language = editor && readLanguage(editor.document);
    if (!editor || !language) { return; }
    const project = findCitingProject(this.deps.projects, editor.document.uri.fsPath);
    if (!project) {
      await vscode.window.showInformationMessage("Open a writing project first");
      return;
    }
    let items: NoteInsertable[];
    try {
      items = await listNoteInsertables(this.sourceOf(project));
    } catch (error) {
      await this.deps.logger.error(MODULE, error, { action: "list-insertables" });
      await vscode.window.showErrorMessage(`Could not read the notes: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (items.length === 0) {
      await vscode.window.showInformationMessage(NO_ITEMS);
      return;
    }
    const titles = await this.paperTitles();
    const picked = await vscode.window.showQuickPick(pickerEntries(items, titles), {
      title: "Insert from note", placeHolder: "Search equations and outputs by label or note", matchOnDescription: true,
    });
    if (!picked || !("item" in picked)) { return; }
    let text: string;
    try {
      text = await buildInsert(picked.item, language);
    } catch (error) {
      await vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    const { document, selection } = editor;
    const before = document.lineAt(selection.start.line).text.slice(0, selection.start.character);
    const after = document.lineAt(selection.end.line).text.slice(selection.end.character);
    const block = `${before.trim() === "" ? "" : "\n"}${text}${after.trim() === "" ? "" : "\n"}`;
    const applied = await editor.edit((builder) => builder.replace(selection, block));
    if (applied) { await this.refresh(document); }
  }

  private async paperTitles(): Promise<Map<string, string>> {
    const library = this.deps.library();
    const papers = library ? await guarded<PaperRecord[]>(this.deps, [], "list-papers", () => library.listPapers()) : [];
    return new Map(papers.map((paper) => [paper.id, paper.title]));
  }

  // ---- Update and differences

  private async viewAt(uriArg: vscode.Uri | string, line: number): Promise<{ document: vscode.TextDocument; language: Language; view: OriginView } | undefined> {
    const uri = typeof uriArg === "string" ? vscode.Uri.parse(uriArg) : uriArg;
    const document = await vscode.workspace.openTextDocument(uri);
    const language = readLanguage(document);
    if (!language) { return undefined; }
    const view = (await this.refresh(document)).find((candidate) => candidate.origin.line === line);
    return view ? { document, language, view } : undefined;
  }

  async updateFromNote(uriArg: vscode.Uri | string, line: number): Promise<void> {
    const found = await this.viewAt(uriArg, line);
    if (!found) { return; }
    const { document, language, view } = found;
    // Anything but stale (or a copy that went fresh since) writes nothing.
    const update = view.item ? await buildUpdate(view.origin, view.state, view.item, language) : undefined;
    if (!update) { return; }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, deriveVscodeRange(update.range), update.text);
    await vscode.workspace.applyEdit(edit);
    await this.refresh(document);
  }

  async showNoteDiff(uriArg: vscode.Uri | string, line: number): Promise<void> {
    const found = await this.viewAt(uriArg, line);
    const item = found?.view.item;
    if (!found || !item) { return; }
    const { document, view } = found;
    const texts = diffOrigin(view.origin, view.manuscriptLatex, item);
    const id = ++this.diffCount;
    const left = vscode.Uri.parse(`${DIFF_SCHEME}:/${id}/manuscript.tex`);
    const right = vscode.Uri.parse(`${DIFF_SCHEME}:/${id}/note.tex`);
    this.diffTexts.set(left.toString(), texts.manuscript);
    this.diffTexts.set(right.toString(), texts.note);
    const key = document.uri.toString();
    this.diffKeys.set(key, [...(this.diffKeys.get(key) ?? []), left.toString(), right.toString()]);
    await vscode.commands.executeCommand("vscode.diff", left, right, `${view.origin.label}: manuscript ↔ note`);
  }

  diffText(uri: vscode.Uri): string {
    return this.diffTexts.get(uri.toString()) ?? "";
  }
}

type PickerEntry = vscode.QuickPickItem | (vscode.QuickPickItem & { item: NoteInsertable });

/** Equations then outputs, each group under a separator; a group with no items is left out. */
function pickerEntries(items: readonly NoteInsertable[], paperTitles: ReadonlyMap<string, string>): PickerEntry[] {
  const entries: PickerEntry[] = [];
  const groups: { source: NoteInsertable["source"]; heading: string; icon: string }[] = [
    { source: "equation", heading: "Equations", icon: "symbol-operator" },
    { source: "output", heading: "Outputs", icon: "output" },
  ];
  for (const group of groups) {
    const members = items.filter((item) => item.source === group.source);
    if (members.length === 0) { continue; }
    entries.push({ label: group.heading, kind: vscode.QuickPickItemKind.Separator });
    for (const item of members) {
      const paperId = paperIdOf(item.notePath);
      const title = paperId !== undefined ? paperTitles.get(paperId) ?? paperId : item.title;
      entries.push({
        label: item.label, description: item.outOfDate ? `${title} · out of date` : title,
        iconPath: new vscode.ThemeIcon(group.icon), item,
      });
    }
  }
  return entries;
}

class NoteMarkHoverProvider implements vscode.HoverProvider {
  constructor(private readonly links: NoteLinks) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const view = this.links.viewsOf(document).find((candidate) => candidate.origin.line === position.line);
    const sentence = view && describeState(view);
    if (!view || !sentence || position.character < view.commentStart) { return undefined; }
    const { line } = view.origin;
    const actions: string[] = [];
    if (view.state === "stale") { actions.push(commandLink("Update from note", UPDATE_COMMAND, document, line)); }
    if (view.state === "stale" || view.state === "diverged" || view.state === "both") { actions.push(commandLink("Show differences", DIFF_COMMAND, document, line)); }
    const markdown = new vscode.MarkdownString([escapeMarkdown(sentence), actions.join(" · ")].filter((part) => part !== "").join("\n\n"));
    markdown.isTrusted = { enabledCommands: [UPDATE_COMMAND, DIFF_COMMAND] };
    return new vscode.Hover(markdown, new vscode.Range(line, view.commentStart, line, view.lineLength));
  }
}

class NoteActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly links: NoteLinks) {}

  async provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    const language = readLanguage(document);
    for (const mark of context.diagnostics) {
      if (mark.source !== MARK_SOURCE || !language) { continue; }
      const line = mark.range.start.line;
      const view = this.links.viewsOf(document).find((candidate) => candidate.origin.line === line);
      if (!view || view.state !== mark.code) { continue; }
      if (view.state === "stale" && view.item) {
        const update = await buildUpdate(view.origin, view.state, view.item, language);
        if (update) {
          const action = new vscode.CodeAction("Update from note", vscode.CodeActionKind.QuickFix);
          action.diagnostics = [mark];
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, deriveVscodeRange(update.range), update.text);
          // Runs after the edit: the copy is fresh by then, so it only recomputes the marks.
          action.command = { command: UPDATE_COMMAND, title: "Update from note", arguments: [document.uri, line] };
          actions.push(action);
        }
      }
      if (view.state === "stale" || view.state === "diverged" || view.state === "both") {
        const action = new vscode.CodeAction("Show differences", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [mark];
        action.command = { command: DIFF_COMMAND, title: "Show differences", arguments: [document.uri, line] };
        actions.push(action);
      }
    }
    return actions;
  }
}

/**
 * Registers "Insert from note", the marks on inserted copies, their hover and the "Update from note" and "Show differences" actions.
 * @returns the note insert source of a project, which the LabShelf editor's "Insert from note" reads
 */
export function registerNoteLinks(context: vscode.ExtensionContext, deps: NoteLinkDeps): (project: ReadyProject) => NoteInsertSource {
  const links = new NoteLinks(deps);
  const run = (id: string, action: () => Promise<void>): Promise<void> => runSafely(deps.logger, id, action);
  const subscriptions = context.subscriptions;
  subscriptions.push(
    links,
    vscode.commands.registerCommand(INSERT_COMMAND, () => run(INSERT_COMMAND, () => links.insertFromNote())),
    vscode.commands.registerCommand(UPDATE_COMMAND, (uri: vscode.Uri | string, line: number) => run(UPDATE_COMMAND, () => links.updateFromNote(uri, line))),
    vscode.commands.registerCommand(DIFF_COMMAND, (uri: vscode.Uri | string, line: number) => run(DIFF_COMMAND, () => links.showNoteDiff(uri, line))),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, { provideTextDocumentContent: (uri) => links.diffText(uri) }),
    vscode.languages.registerHoverProvider(SOURCES, new NoteMarkHoverProvider(links)),
    vscode.languages.registerCodeActionsProvider(SOURCES, new NoteActionProvider(links), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.workspace.onDidOpenTextDocument((document) => { void links.refresh(document); }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.fsPath.endsWith(".qmd")) { links.refreshOpenDocuments(); } else { void links.refresh(document); }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => links.forget(document)),
  );
  for (const editor of vscode.window.visibleTextEditors ?? []) { void links.refresh(editor.document); }
  return (project) => createNoteInsertSource(deps, project);
}
