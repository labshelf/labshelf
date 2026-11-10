// "Insert from note" for LaTeX manuscripts, and the state of each inserted copy: marks, hover, "Update from note" and "Show differences".
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import * as vscode from "vscode";

import {
  buildInsert, buildUpdate, deriveOriginHash, deriveOriginState, derivePapersByCiteKey, diffOrigin, findOriginCommentStart,
  listNoteInsertables, listProjectCiteKeys, readOriginLatex, scanOrigins,
  type ILogger, type ManuscriptOrigin, type NoteInsertable, type NoteInsertSource, type OriginState, type PaperRecord, type ProjectNotesStore,
} from "@labshelf/core";
import { runSafely } from "../../command/index.js";
import { findCitingProject } from "./backlinks.js";
import { insertBlock, readManuscriptLanguage as readLanguage, type ManuscriptLanguage as Language } from "./linkMarks.js";
import { ManuscriptMarks, registerManuscriptMarks, type MarkedView, type MarkKind } from "./manuscriptMarks.js";
import type { ReadyProject, WritingProjects } from "../projects/index.js";

const MODULE = "writing/noteLinks";
const INSERT_COMMAND = "labshelf.writing.insertFromNote";
const PAPER_NOTE = /^paper:(.+)\/notes\.qmd$/;
const NO_ITEMS = "No equations or outputs found in this project's notes or the cited papers' notes.";

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
interface OriginView extends MarkedView {
  origin: ManuscriptOrigin;
  state: OriginState;
  item?: NoteInsertable;
  manuscriptLatex: string;
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
    return { origin, line: origin.line, state, manuscriptLatex, commentStart: start >= 0 ? start : 0, lineLength: content.length, ...(item ? { item } : {}) };
  }));
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

function createNoteMarkKind(deps: NoteLinkDeps): MarkKind<OriginView> {
  return {
    module: MODULE,
    collection: "LabShelf notes",
    source: "LabShelf",
    diffScheme: "labshelf-origin",
    updateTitle: "Update from note",
    updateCommand: "labshelf.writing.updateFromNote",
    diffCommand: "labshelf.writing.showNoteDiff",
    describe: describeState,
    prepare(document) {
      const language = readLanguage(document);
      const project = language && findCitingProject(deps.projects, document.uri.fsPath);
      if (!language || !project) { return undefined; }
      return async () => {
        const text = document.getText();
        const items = scanOrigins(language, text).length === 0 ? [] : await listNoteInsertables(createNoteInsertSource(deps, project));
        return computeViews(language, text, items);
      };
    },
    async buildUpdate(document, view) {
      const language = readLanguage(document);
      return language && view.item ? buildUpdate(view.origin, view.state, view.item, language) : undefined;
    },
    async showDiff(diffs, document, view) {
      if (!view.item) { return; }
      const texts = diffOrigin(view.origin, view.manuscriptLatex, view.item);
      await diffs.open(document.uri, { name: "manuscript.tex", text: texts.manuscript }, { name: "note.tex", text: texts.note }, `${view.origin.label}: manuscript ↔ note`);
    },
  };
}

async function insertFromNote(deps: NoteLinkDeps, marks: ManuscriptMarks<OriginView>): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const language = editor && readLanguage(editor.document);
  if (!editor || !language) { return; }
  const project = findCitingProject(deps.projects, editor.document.uri.fsPath);
  if (!project) {
    await vscode.window.showInformationMessage("Open a writing project first");
    return;
  }
  let items: NoteInsertable[];
  try {
    items = await listNoteInsertables(createNoteInsertSource(deps, project));
  } catch (error) {
    await deps.logger.error(MODULE, error, { action: "list-insertables" });
    await vscode.window.showErrorMessage(`Could not read the notes: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (items.length === 0) {
    await vscode.window.showInformationMessage(NO_ITEMS);
    return;
  }
  const titles = await paperTitles(deps);
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
  if (await insertBlock(editor, text)) { await marks.refresh(editor.document); }
}

async function paperTitles(deps: NoteLinkDeps): Promise<Map<string, string>> {
  const library = deps.library();
  const papers = library ? await guarded<PaperRecord[]>(deps, [], "list-papers", () => library.listPapers()) : [];
  return new Map(papers.map((paper) => [paper.id, paper.title]));
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

/**
 * Registers "Insert from note", the marks on inserted copies, their hover and the "Update from note" and "Show differences" actions.
 * @returns the note insert source of a project, which the LabShelf editor's "Insert from note" reads
 */
export function registerNoteLinks(context: vscode.ExtensionContext, deps: NoteLinkDeps): (project: ReadyProject) => NoteInsertSource {
  const kind = createNoteMarkKind(deps);
  const marks = new ManuscriptMarks(kind, deps.logger);
  context.subscriptions.push(
    vscode.commands.registerCommand(INSERT_COMMAND, () => runSafely(deps.logger, INSERT_COMMAND, () => insertFromNote(deps, marks))),
  );
  registerManuscriptMarks(context, marks, kind, deps.logger, (document) => document.uri.fsPath.endsWith(".qmd"));
  return (project) => createNoteInsertSource(deps, project);
}
