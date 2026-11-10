// Marks the equations a manuscript took from notes with the state of their copy, and runs "Insert from note", "Update from note" and "Show differences" on the source editor.
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  buildInsert, buildUpdate, deriveOriginHash, deriveOriginState, diffOrigin, findOriginCommentStart, formatError, listNoteInsertables, readOriginLatex, scanOrigins,
  type ILogger, type ManuscriptOrigin, type NoteInsertSource, type NoteInsertable, type OriginState, type PaperRecord,
} from "../../../index.js";
import { pickQuickEntry, showToast, type QuickPickEntry } from "../../../ui/dom/index.js";
import { applyRangeEdit, createLinkController, insertBlock, openDiffDialog, toOffset, type LinkActions, type LinkButton, type LinkController, type LinkMark, type LinkRuntime as SharedRuntime } from "./linkMarks.js";

const MODULE = "editor.noteLinks";
const PAPER_NOTE = /^paper:(.+)\/notes\.qmd$/;

export interface NoteLinkDeps {
  language: "latex" | "typst";
  /** Where the notes are read from; a reader that fails answers empty, so one bad note never empties the picker. */
  source: NoteInsertSource;
  /** The library's papers, for the title shown beside an equation of a paper's notes. */
  papers(): Promise<readonly PaperRecord[]>;
  logger: ILogger;
}

/** What the editor's actions run; each one acts on the editor it was made for. */
/** What the editor's note-link actions run: Insert from note at the cursor, and Update from note and Show differences on the copy under it. */
export type NoteLinkActions = LinkActions;

export type NoteLinks = LinkController;

interface ResolvedOrigin { origin: ManuscriptOrigin; item: NoteInsertable | undefined; state: OriginState }

/** The sentence that says what a state means for the copy at `notePath`. */
function describeState(state: OriginState, label: string, notePath: string): string {
  switch (state) {
    case "fresh": return `${label}: the same as in the note.`;
    case "stale": return `${label}: the note changed since it was inserted. Update from note replaces this copy.`;
    case "diverged": return `${label}: edited here, so it differs from the note. LabShelf will not overwrite it.`;
    case "both": return `${label}: edited here and changed in the note. LabShelf will not overwrite it.`;
    case "missing": return `${label}: not found in ${notePath}. The note or its label was removed or renamed.`;
  }
}

const sentenceOf = ({ state, origin }: ResolvedOrigin): string => describeState(state, origin.label, origin.notePath);

/** The state of every origin of `text`; the notes are read only when the text has an origin. */
async function resolveOrigins({ source, language }: NoteLinkDeps, text: string): Promise<ResolvedOrigin[]> {
  const origins = scanOrigins(language, text);
  if (origins.length === 0) return [];
  const items = await listNoteInsertables(source);
  return Promise.all(origins.map(async (origin) => {
    const item = items.find((candidate) => candidate.notePath === origin.notePath && candidate.label === origin.label);
    const manuscriptHash = await deriveOriginHash(readOriginLatex(language, text, origin));
    const state = deriveOriginState(origin, manuscriptHash, item ? { hash: await deriveOriginHash(item.latex) } : undefined);
    return { origin, item, state };
  }));
}

/** The origin comment of each origin that is not fresh. */
function toMarks(doc: Text, resolved: readonly ResolvedOrigin[]): LinkMark[] {
  const marks: LinkMark[] = [];
  for (const entry of resolved) {
    if (entry.state === "fresh" || entry.origin.line + 1 > doc.lines) continue;
    const line = doc.line(entry.origin.line + 1);
    const start = findOriginCommentStart(line.text);
    if (start < 0) continue;
    marks.push({ from: line.from + start, to: line.to, state: entry.state, sentence: sentenceOf(entry) });
  }
  return marks;
}

/** The picker's entries: equations, then outputs, each group only when it has items. */
function pickerEntries(items: readonly NoteInsertable[], titleOf: (item: NoteInsertable) => string): QuickPickEntry<NoteInsertable>[] {
  const group = (heading: string, source: NoteInsertable["source"]): QuickPickEntry<NoteInsertable>[] => {
    const own = items.filter((item) => item.source === source);
    if (own.length === 0) return [];
    return [
      { kind: "separator", label: heading },
      ...own.map((item) => ({
        label: item.label, description: item.outOfDate ? `${titleOf(item)} · out of date` : titleOf(item),
        icon: source === "equation" ? ("symbol-operator" as const) : ("file-media" as const), value: item,
      })),
    ];
  };
  return [...group("Equations", "equation"), ...group("Outputs", "output")];
}

function originAtCursor(view: EditorView, language: NoteLinkDeps["language"]): ManuscriptOrigin | undefined {
  const { doc } = view.state;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head).number - 1;
  return scanOrigins(language, doc.toString()).find((origin) =>
    origin.line === line || (toOffset(doc, origin.insertedRange.start) <= head && head <= toOffset(doc, origin.insertedRange.end)));
}

/** What every concept below shares: the deps, the refresh of the marks, and the guard that logs and shows what an action throws. */
type LinkRuntime = SharedRuntime<NoteLinkDeps>;

const titleOfItem = (papers: readonly PaperRecord[]) => (item: NoteInsertable): string => {
  const id = PAPER_NOTE.exec(item.notePath)?.[1];
  return id === undefined ? item.title : (papers.find((paper) => paper.id === id)?.title || id);
};

/** The notes' equations and outputs, or undefined (after telling the user why) when there are none to pick. */
async function readInsertables({ deps }: LinkRuntime): Promise<NoteInsertable[] | undefined> {
  let items: NoteInsertable[];
  try {
    items = await listNoteInsertables(deps.source);
  } catch (error) {
    void deps.logger.error(MODULE, error, { action: "listNoteInsertables" });
    showToast(`Could not read the notes: ${formatError(error)}`, "error");
    return undefined;
  }
  if (items.length === 0) {
    showToast("No equations or outputs found in this project's notes or the cited papers' notes.", "info");
    return undefined;
  }
  return items;
}

/** The block to insert for the item the user picks, or undefined when nothing was picked or it cannot be built. */
async function pickBlock(rt: LinkRuntime): Promise<string | undefined> {
  const items = await readInsertables(rt);
  if (!items) return undefined;
  const entries = pickerEntries(items, titleOfItem(await rt.deps.papers()));
  const item = await pickQuickEntry(entries, { title: "Insert from note", placeholder: "Search equations and outputs by label or note" });
  if (!item) return undefined;
  try {
    return await buildInsert(item, rt.deps.language);
  } catch (error) {
    showToast(formatError(error), "info");
    return undefined;
  }
}

const insertFromNotes = (rt: LinkRuntime, view: EditorView): Promise<void> => rt.guarded("insert from the notes", async () => {
  const block = await pickBlock(rt);
  if (block === undefined) return;
  insertBlock(view, block);
  await rt.refresh(view);
});

/** The origin on `line` with its state, or undefined (after a new refresh) when the text changed while the notes were read. */
async function resolveLine(rt: LinkRuntime, view: EditorView, line: number): Promise<ResolvedOrigin | undefined> {
  const doc = view.state.doc;
  const found = (await resolveOrigins(rt.deps, doc.toString())).find((entry) => entry.origin.line === line);
  if (found && view.state.doc === doc) return found;
  void rt.refresh(view);
  return undefined;
}

async function applyUpdate(rt: LinkRuntime, view: EditorView, line: number): Promise<void> {
  const doc = view.state.doc;
  const found = await resolveLine(rt, view, line);
  if (!found) return;
  if (found.state !== "stale" || !found.item) {
    showToast(sentenceOf(found), "info");
    return;
  }
  let update: Awaited<ReturnType<typeof buildUpdate>>;
  try {
    update = await buildUpdate(found.origin, found.state, found.item, rt.deps.language);
  } catch (error) {
    showToast(formatError(error), "info");
    return;
  }
  if (!update || view.state.doc !== doc) { void rt.refresh(view); return; }
  applyRangeEdit(view, doc, update);
  await rt.refresh(view);
}

async function showDiff(rt: LinkRuntime, view: EditorView, line: number): Promise<void> {
  const found = await resolveLine(rt, view, line);
  if (!found) return;
  const { origin, item, state } = found;
  if (!item || state === "fresh") {
    showToast(sentenceOf(found), "info");
    return;
  }
  const texts = diffOrigin(origin, readOriginLatex(rt.deps.language, view.state.doc.toString(), origin), item);
  openDiffDialog({
    view, title: `${origin.label}: manuscript ↔ note`, subtitle: item.title,
    columns: [{ heading: "In the manuscript", text: texts.manuscript }, { heading: "In the note", text: texts.note }], updateLabel: "Update from note",
    update: state === "stale" ? () => applyUpdate(rt, view, line).catch((error: unknown) => {
      void rt.deps.logger.error(MODULE, error, { action: "updateFromNote" });
      showToast(`Could not update from the note: ${formatError(error)}`, "error");
    }) : undefined,
  });
}

const atCursor = (rt: LinkRuntime, view: EditorView, act: (line: number) => Promise<void>): Promise<void> => rt.guarded("read the equation", async () => {
  const origin = originAtCursor(view, rt.deps.language);
  if (!origin) { showToast("Place the cursor on an equation inserted from a note.", "info"); return; }
  await act(origin.line);
});

/** The hover's actions for a mark: Update from note for a stale copy, Show differences for any copy the note still has. */
const buttonsFor = (rt: LinkRuntime) => (view: EditorView, mark: LinkMark, line: number): LinkButton[] => [
  ...(mark.state === "stale" ? [{ label: "Update from note", primary: true, run: () => applyUpdate(rt, view, line) }] : []),
  ...(mark.state !== "missing" ? [{ label: "Show differences", primary: false, run: () => showDiff(rt, view, line) }] : []),
];

export function createNoteLinks(deps: NoteLinkDeps): NoteLinks {
  return createLinkController(deps, {
    module: MODULE, subject: "read the equation", refreshAction: "refreshOrigins",
    compute: async (_rt, text, doc) => toMarks(doc, await resolveOrigins(deps, text)),
    buttonsFor, insert: insertFromNotes, atCursor, update: applyUpdate, showDiff,
  });
}
