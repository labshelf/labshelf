// Marks the equations a manuscript took from notes with the state of their copy, and runs "Insert from note", "Update from note" and "Show differences" on the source editor.
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import {
  buildInsert, buildUpdate, deriveOriginHash, deriveOriginState, diffOrigin, findOriginCommentStart, formatError, listNoteInsertables, readOriginLatex, scanOrigins,
  type ILogger, type ManuscriptOrigin, type NoteInsertSource, type NoteInsertable, type OriginState, type PaperRecord,
} from "@labshelf/core";
import { mountOverlay, pickQuickEntry, renderElement, showToast, type QuickPickEntry } from "@labshelf/core/dom";

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
export interface NoteLinkActions {
  /** Picks an equation or output of the notes and puts it, with its origin comment, at the cursor. */
  insert(): Promise<void>;
  /** Replaces the copy under the cursor with the note's, when only the note changed. */
  update(): Promise<void>;
  /** Shows the copy under the cursor beside the note's. */
  showDifferences(): Promise<void>;
}

export interface NoteLinks {
  extension: Extension;
  /** Recomputes the state of every origin; a later call wins over an earlier one still reading. Resolves when this call is done. */
  refresh(view: EditorView): Promise<void>;
  /** Stops the refreshes that are still reading. */
  close(): void;
  actionsFor(view: EditorView): NoteLinkActions;
}

type MarkState = Exclude<OriginState, "fresh">;

interface OriginMark { from: number; to: number; state: MarkState; sentence: string; level: "info" | "warning" }

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
const levelOf = (state: OriginState): "info" | "warning" => (state === "stale" || state === "fresh" ? "info" : "warning");

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

function toOffset(doc: Text, position: { line: number; character: number }): number {
  return doc.line(Math.min(Math.max(position.line + 1, 1), doc.lines)).from + position.character;
}

/** The origin comment of each origin that is not fresh. */
function toMarks(doc: Text, resolved: readonly ResolvedOrigin[]): OriginMark[] {
  const marks: OriginMark[] = [];
  for (const entry of resolved) {
    if (entry.state === "fresh" || entry.origin.line + 1 > doc.lines) continue;
    const line = doc.line(entry.origin.line + 1);
    const start = findOriginCommentStart(line.text);
    if (start < 0) continue;
    marks.push({ from: line.from + start, to: line.to, state: entry.state, sentence: sentenceOf(entry), level: levelOf(entry.state) });
  }
  return marks;
}

const replaceMarks = StateEffect.define<readonly OriginMark[]>();

// INVARIANT: marks are kept in document offsets and mapped through edits; an edit that deletes a mark leaves it empty and it is not drawn.
const marksField = StateField.define<readonly OriginMark[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(replaceMarks)) return effect.value;
    if (!transaction.docChanged) return value;
    return value.map((mark) => ({ ...mark, from: transaction.changes.mapPos(mark.from, 1), to: transaction.changes.mapPos(mark.to, -1) }));
  },
});

const markDecorations = EditorView.decorations.compute([marksField], (state) =>
  Decoration.set(
    state.field(marksField)
      .filter((mark) => mark.to > mark.from && mark.from >= 0 && mark.to <= state.doc.length)
      .map((mark) => Decoration.mark({ class: `ls-origin-mark ls-origin-${mark.state}`, attributes: { title: mark.sentence } }).range(mark.from, mark.to)),
    true,
  ));

/** The look of the marks and of the hover. */
const originTheme = EditorView.theme({
  ".ls-origin-stale": { textDecoration: "underline dotted var(--ls-mark-accent)" },
  ".ls-origin-diverged, .ls-origin-both, .ls-origin-missing": { textDecoration: "underline wavy var(--ls-warning)" },
  ".ls-origin-tip": {
    display: "flex", flexDirection: "column", gap: "var(--ls-space-2)", maxWidth: "min(32em, 90vw)", boxSizing: "border-box", padding: "var(--ls-space-3)",
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)", borderRadius: "var(--ls-radius)",
    boxShadow: "var(--ls-widget-shadow)", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)",
  },
  ".ls-origin-tip .ls-dialog-msg": { margin: "0" },
  ".ls-origin-tip-actions": { display: "flex", flexWrap: "wrap", gap: "var(--ls-space-2)" },
});

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

/** Line breaks as the document writes them, since CodeMirror splits an inserted string only on its own line separator. */
const withLineBreaks = (view: EditorView, text: string): string => text.replace(/\n/g, view.state.lineBreak);

function originAtCursor(view: EditorView, language: NoteLinkDeps["language"]): ManuscriptOrigin | undefined {
  const { doc } = view.state;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head).number - 1;
  return scanOrigins(language, doc.toString()).find((origin) =>
    origin.line === line || (toOffset(doc, origin.insertedRange.start) <= head && head <= toOffset(doc, origin.insertedRange.end)));
}

/** What every concept below shares: the deps, the refresh of the marks, and the guard that logs and shows what an action throws. */
interface LinkRuntime {
  deps: NoteLinkDeps;
  refresh(view: EditorView): Promise<void>;
  guarded(action: string, run: () => Promise<void>): Promise<void>;
}

/** Recomputes the marks; a later call for the same view wins over an earlier one still reading. */
function createRefresh(deps: NoteLinkDeps, isClosed: () => boolean): LinkRuntime["refresh"] {
  const requests = new WeakMap<EditorView, number>();
  const refresh = async (view: EditorView): Promise<void> => {
    const mine = (requests.get(view) ?? 0) + 1;
    requests.set(view, mine);
    const doc = view.state.doc;
    try {
      const resolved = await resolveOrigins(deps, doc.toString());
      if (isClosed() || requests.get(view) !== mine) return;
      // The text moved on while the notes were read: positions would not fit, so read again.
      if (view.state.doc !== doc) { await refresh(view); return; }
      view.dispatch({ effects: replaceMarks.of(toMarks(doc, resolved)) });
    } catch (error) {
      void deps.logger.error(MODULE, error, { action: "refreshOrigins" });
    }
  };
  return refresh;
}

/** Runs an action; whatever it throws is logged and shown. */
function createGuard(logger: ILogger): LinkRuntime["guarded"] {
  return async (action, run) => {
    try {
      await run();
    } catch (error) {
      void logger.error(MODULE, error, { action });
      showToast(`Could not ${action}: ${formatError(error)}`, "error");
    }
  };
}

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

/** Puts `block` at the selection, on lines of its own. */
function insertBlock(view: EditorView, block: string): void {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const before = doc.sliceString(doc.lineAt(from).from, from).trim() !== "";
  const after = doc.sliceString(to, doc.lineAt(to).to).trim() !== "";
  const text = withLineBreaks(view, `${before ? "\n" : ""}${block}${after ? "\n" : ""}`);
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length - (after ? view.state.lineBreak.length : 0) }, scrollIntoView: true, userEvent: "input" });
  view.focus();
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
  view.dispatch({
    changes: { from: toOffset(doc, update.range.start), to: toOffset(doc, update.range.end), insert: withLineBreaks(view, update.text) },
    userEvent: "input",
  });
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
    view, title: `${origin.label}: manuscript ↔ note`, noteTitle: item.title, texts,
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

/** The tooltip over a mark: what its state means, with the actions that fit it. */
function tooltipFor(rt: LinkRuntime, view: EditorView, mark: OriginMark): Tooltip {
  const line = view.state.doc.lineAt(mark.from).number - 1;
  return {
    pos: mark.from, end: mark.to, above: true,
    create: () => {
      const actions = renderElement("div", { class: "ls-origin-tip-actions" });
      const add = (label: string, primary: boolean, run: () => Promise<void>): void => {
        const button = renderElement("button", { type: "button", class: primary ? "ls-btn ls-btn-primary" : "ls-btn", text: label });
        button.addEventListener("click", () => void rt.guarded("read the equation", run));
        actions.append(button);
      };
      if (mark.state === "stale") add("Update from note", true, () => applyUpdate(rt, view, line));
      if (mark.state !== "missing") add("Show differences", false, () => showDiff(rt, view, line));
      const dom = renderElement("div", { class: "ls-origin-tip" }, renderElement("p", { class: "ls-dialog-msg", text: mark.sentence }));
      if (actions.childElementCount > 0) dom.append(actions);
      return { dom };
    },
  };
}

const createHover = (rt: LinkRuntime): Extension => hoverTooltip((view, pos): Tooltip | null => {
  const mark = view.state.field(marksField).find((candidate) => candidate.to > candidate.from && pos >= candidate.from && pos <= candidate.to);
  return mark ? tooltipFor(rt, view, mark) : null;
});

export function createNoteLinks(deps: NoteLinkDeps): NoteLinks {
  let closed = false;
  const rt: LinkRuntime = { deps, refresh: createRefresh(deps, () => closed), guarded: createGuard(deps.logger) };
  return {
    extension: [marksField, markDecorations, createHover(rt), originTheme],
    refresh: rt.refresh,
    close() { closed = true; },
    actionsFor: (view) => ({
      insert: () => insertFromNotes(rt, view),
      update: () => atCursor(rt, view, (line) => applyUpdate(rt, view, line)),
      showDifferences: () => atCursor(rt, view, (line) => showDiff(rt, view, line)),
    }),
  };
}

interface DiffDialog {
  view: EditorView;
  title: string;
  noteTitle: string;
  texts: { manuscript: string; note: string };
  /** Present only for a stale copy: applies the update. */
  update: (() => void) | undefined;
}

/** A read-only dialog with the two texts side by side; nothing is written unless the stale copy's update is chosen. */
function openDiffDialog({ view, title, noteTitle, texts, update }: DiffDialog): void {
  const column = (heading: string, text: string): HTMLElement =>
    renderElement("div", { class: "ls-origin-diff-col" }, renderElement("h3", { text: heading }), renderElement("pre", { text }));
  const heading = renderElement("div", { class: "ls-dialog-title", id: "ls-origin-diff-title", text: title });
  const close = renderElement("button", { type: "button", class: "ls-btn", text: "Close" });
  const actions = renderElement("div", { class: "ls-dialog-actions" }, close);
  const dialog = renderElement("div", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": heading.id },
    renderElement("div", { class: "ls-dialog-head" }, renderElement("div", {}, heading, renderElement("p", { class: "ls-dialog-msg", text: noteTitle }))),
    renderElement("div", { class: "ls-origin-diff" }, column("In the manuscript", texts.manuscript), column("In the note", texts.note)),
    actions);
  const dismiss = (): void => { overlay.close(); view.focus(); };
  const overlay = mountOverlay(dialog, dismiss);
  close.addEventListener("click", dismiss);
  if (update) {
    const apply = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Update from note" });
    apply.addEventListener("click", () => { dismiss(); update(); });
    actions.append(apply);
  }
  close.focus();
}
