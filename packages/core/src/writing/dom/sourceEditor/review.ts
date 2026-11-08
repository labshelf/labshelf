/** Review mode: records the user's edits in Reviewing as tracked changes (D4), accepts or rejects them, and keeps the file's suggestion list in step. */
import { Annotation, type AnnotationType, Compartment, EditorState, Facet, StateEffect, type StateEffectType, StateField, type Text, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ySyncAnnotation } from "y-codemirror.next";
import { AUTO_SAVE_DELAY_MS, createDebouncer, type EditorSuggestions, type FileSuggestion, type ILogger, type ReviewMode } from "../../../index.js";
import { docOffsetToFile, fileOffsetToDoc } from "../../../collab/dom/index.js";
import { fromDisk } from "./openEditors.js";
import { createReviewView, reviewModeDropdown } from "./reviewView.js";
import type { SourceToolbarDropdown } from "./toolbar.js";

/** One suggestion: an insert covers from..to of the current text; a delete sits at from === to and holds the removed text. */
export interface TrackedChange { id: string; kind: "insert" | "delete"; from: number; to: number; text?: string; group?: string; author: string; created: string }

/** Marks a transaction to record as a suggestion in Reviewing even though it carries no input, delete or move user event. */
export const reviewEdit: AnnotationType<boolean> = Annotation.define<boolean>();

export interface ReviewTracking {
  extension: Extension;
  setMode(view: EditorView, mode: ReviewMode): void;
  changes(state: EditorState): readonly TrackedChange[];
  load(view: EditorView, changes: readonly TrackedChange[]): void;
  accept(view: EditorView, ids: readonly string[]): void;
  reject(view: EditorView, ids: readonly string[]): void;
}

interface TrackContext { author: string; now(): string; newId(): string }

const reviewMode = Facet.define<ReviewMode, ReviewMode>({ combine: (values) => values[values.length - 1] ?? "editing" });
/** Marks the revert of a reject: neither tracked nor a suggestion in the history. */
const reviewRevert = Annotation.define<boolean>();
// TRAP: from core, y-codemirror.next's annotation resolves to a copy of @codemirror/state that tsc treats as unrelated to ours; the shape is the same.
const ySync = ySyncAnnotation as unknown as AnnotationType<unknown>;

function isExempt(tr: Transaction): boolean {
  return Boolean(tr.annotation(fromDisk)) || Boolean(tr.annotation(Transaction.remote)) || tr.annotation(ySync) !== undefined
    || Boolean(tr.annotation(reviewRevert)) || tr.isUserEvent("undo") || tr.isUserEvent("redo");
}

function isTracked(tr: Transaction): boolean {
  if (tr.startState.facet(reviewMode) !== "reviewing" || isExempt(tr)) { return false; }
  return tr.annotation(reviewEdit) === true || tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("move");
}

function withGroup(record: Omit<TrackedChange, "group">, group: string | undefined): TrackedChange {
  return group === undefined ? record : { ...record, group };
}

function sortRecords(records: readonly TrackedChange[]): TrackedChange[] {
  return [...records].sort((a, b) => a.from - b.from || (a.kind === b.kind ? 0 : a.kind === "delete" ? -1 : 1));
}

/** Maps records through a change that is not a suggestion; an undo that puts back exactly a delete's text at its position drops that delete. */
function mapUntracked(records: readonly TrackedChange[], tr: Transaction): TrackedChange[] {
  const restored = new Set<string>();
  const removed: Span[] = [];
  const undo = tr.isUserEvent("undo");
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (toA > fromA) { removed.push({ from: fromA, to: toA }); }
    if (!undo) { return; }
    const text = inserted.toString();
    const match = records.find((r) => r.kind === "delete" && r.from === fromA && r.text === text && !restored.has(r.id));
    if (match) { restored.add(match.id); }
  });
  const out: TrackedChange[] = [];
  for (const record of records) {
    if (restored.has(record.id)) { continue; }
    if (record.kind === "delete") {
      const at = tr.changes.mapPos(record.from, -1);
      out.push({ ...record, from: at, to: at });
      continue;
    }
    // An insert keeps the span of its surviving characters: mapping its bare edges would let a replacement over it keep the new text.
    let spans: Span[] = [{ from: record.from, to: record.to }];
    for (const cut of removed) { spans = spans.flatMap((s) => subtract(s, cut)); }
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (!first || !last) { continue; }
    const from = tr.changes.mapPos(first.from, 1);
    const to = tr.changes.mapPos(last.to, -1);
    if (to > from) { out.push({ ...record, from, to }); }
  }
  return out;
}

interface Span { from: number; to: number }

function subtract(span: Span, cut: Span): Span[] {
  if (cut.to <= span.from || cut.from >= span.to) { return [span]; }
  return [{ from: span.from, to: cut.from }, { from: cut.to, to: span.to }].filter((s) => s.to > s.from);
}

function mapThroughDeletion(record: TrackedChange, from: number, to: number): TrackedChange | null {
  const map = (p: number): number => (p < from ? p : p <= to ? from : p - (to - from));
  const start = map(record.from);
  const end = map(record.to);
  if (record.kind === "insert" && end <= start) { return null; }
  return { ...record, from: start, to: end };
}

/** Applies one change, in the coordinates of the text before it, to the records as a suggestion of ctx.author. */
function trackChange(records: readonly TrackedChange[], from: number, to: number, deleted: string, inserted: string, ctx: TrackContext): TrackedChange[] {
  let next = [...records];
  let deletion: TrackedChange | undefined;
  if (to > from) {
    const own = next.filter((r) => r.kind === "insert" && r.author === ctx.author);
    const merged = next.filter((r) => r.kind === "delete" && r.from >= from && r.from <= to).sort((a, b) => a.from - b.from);
    // The removed original text: the range less the author's own inserts, split at each crossed delete so their texts fall in document order.
    let spans: Span[] = [{ from, to }];
    for (const r of own) { spans = spans.flatMap((s) => subtract(s, r)); }
    for (const d of merged) { spans = spans.flatMap((s) => (d.from > s.from && d.from < s.to ? [{ from: s.from, to: d.from }, { from: d.from, to: s.to }] : [s])); }
    const pieces = [
      ...spans.map((s) => ({ at: s.from, order: 1, text: deleted.slice(s.from - from, s.to - from) })),
      ...merged.map((d) => ({ at: d.from, order: 0, text: d.text ?? "" })),
    ].sort((a, b) => a.at - b.at || a.order - b.order);
    const rest = next.filter((r) => !merged.includes(r)).map((r) => mapThroughDeletion(r, from, to)).filter((r): r is TrackedChange => r !== null);
    if (spans.length > 0 || merged.length > 1) {
      const first = merged[0];
      deletion = withGroup({ id: first?.id ?? ctx.newId(), kind: "delete", from, to: from, text: pieces.map((p) => p.text).join(""), author: ctx.author, created: ctx.now() }, first?.group);
      next = [...rest, deletion];
    } else {
      next = [...rest, ...merged.map((d) => ({ ...d, from, to: from }))];
    }
  }
  if (inserted.length === 0) { return next; }
  const at = from;
  const size = inserted.length;
  const host = deletion ? undefined : next.find((r) => r.kind === "insert" && r.author === ctx.author && r.from <= at && at <= r.to);
  const shifted = next.map((r): TrackedChange => {
    if (r === host) { return { ...r, to: r.to + size }; }
    if (r.kind === "delete") { return r.from > at ? { ...r, from: r.from + size, to: r.to + size } : r; }
    return { ...r, from: r.from >= at ? r.from + size : r.from, to: r.to > at ? r.to + size : r.to };
  });
  if (host) { return shifted; }
  let group: string | undefined;
  if (deletion) {
    group = deletion.group ?? ctx.newId();
    const id = deletion.id;
    for (let i = 0; i < shifted.length; i++) { if (shifted[i]?.id === id) { shifted[i] = { ...shifted[i]!, group }; } }
  }
  shifted.push(withGroup({ id: ctx.newId(), kind: "insert", from: at, to: at + size, author: ctx.author, created: ctx.now() }, group));
  return shifted;
}

function trackTransaction(records: readonly TrackedChange[], tr: Transaction, ctx: TrackContext): TrackedChange[] {
  let next = [...records];
  const before = tr.startState.doc;
  // Changes apply in order: fromB is where each one starts in the text after the earlier ones, which is the coordinate the records are in.
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    next = trackChange(next, fromB, fromB + (toA - fromA), before.sliceString(fromA, toA), inserted.toString(), ctx);
  });
  return next;
}

interface RecordEffects { replace: StateEffectType<readonly TrackedChange[]>; drop: StateEffectType<readonly string[]> }

/** The tracked records of a state: tracked edits add to them, other edits map them, the effects replace or drop them. */
function createRecordsField(author: () => string, now: () => string, newId: () => string, effects: RecordEffects): StateField<readonly TrackedChange[]> {
  return StateField.define<readonly TrackedChange[]>({
    create: () => [],
    update(value, tr) {
      let next: readonly TrackedChange[] = value;
      if (tr.docChanged) {
        next = isTracked(tr) ? trackTransaction(value, tr, { author: author(), now, newId }) : mapUntracked(value, tr);
      }
      for (const effect of tr.effects) {
        if (effect.is(effects.replace)) { next = [...effect.value]; }
        if (effect.is(effects.drop)) {
          const ids = new Set(effect.value);
          next = next.filter((r) => !ids.has(r.id));
        }
      }
      return next === value ? value : sortRecords(next);
    },
  });
}

/** The records of ids and every record sharing a group with one of them. */
function expandGroups(all: readonly TrackedChange[], ids: readonly string[]): TrackedChange[] {
  const wanted = new Set(ids);
  const groups = new Set(all.filter((r) => wanted.has(r.id) && r.group !== undefined).map((r) => r.group));
  return all.filter((r) => wanted.has(r.id) || (r.group !== undefined && groups.has(r.group)));
}

export function createReviewTracking(options: { author(): string; now?(): string; newId?(): string }): ReviewTracking {
  const now = options.now ?? ((): string => new Date().toISOString());
  const newId = options.newId ?? ((): string => globalThis.crypto.randomUUID());
  const mode = new Compartment();
  const effects: RecordEffects = { replace: StateEffect.define<readonly TrackedChange[]>(), drop: StateEffect.define<readonly string[]>() };
  const field = createRecordsField(options.author, now, newId, effects);
  const changes = (state: EditorState): readonly TrackedChange[] => state.field(field, false) ?? [];
  const expand = (state: EditorState, ids: readonly string[]): TrackedChange[] => expandGroups(changes(state), ids);

  return {
    extension: [field, mode.of(reviewMode.of("editing"))],
    setMode(view, next) {
      view.dispatch({ effects: mode.reconfigure(reviewMode.of(next)) });
    },
    changes,
    load(view, records) {
      view.dispatch({ effects: effects.replace.of(records) });
    },
    accept(view, ids) {
      const chosen = expand(view.state, ids);
      if (chosen.length === 0) { return; }
      view.dispatch({ effects: effects.drop.of(chosen.map((r) => r.id)) });
    },
    reject(view, ids) {
      const chosen = expand(view.state, ids);
      if (chosen.length === 0) { return; }
      const reverts = chosen.map((r) => (r.kind === "insert" ? { from: r.from, to: r.to } : { from: r.from, insert: r.text ?? "" }));
      view.dispatch({
        changes: reverts,
        effects: effects.drop.of(chosen.map((r) => r.id)),
        annotations: [reviewRevert.of(true), Transaction.addToHistory.of(false)],
      });
    },
  };
}

export type { EditorSuggestions, FileSuggestion, ReviewMode };

/** What the editor needs for review mode. */
export interface EditorReview {
  /** The name a new suggestion is recorded under. */
  author(): string;
  /** The mode the editor opens in. */
  mode: ReviewMode;
  suggestions: EditorSuggestions;
  /** Runs when the user picks a mode in the toolbar. */
  onMode?(mode: ReviewMode): void;
}

const REVIEW_MODULE = "editor.review";

function suggestionKey(s: FileSuggestion): string {
  return JSON.stringify([s.kind, s.start, s.end, s.text, s.group, s.author, s.created]);
}

function toFileSuggestion(change: TrackedChange, doc: Text, lineBreak: string): FileSuggestion {
  const { id, kind, author, created, text, group } = change;
  return {
    id, kind, start: docOffsetToFile(doc, lineBreak, change.from), end: docOffsetToFile(doc, lineBreak, change.to), author, created,
    ...(text === undefined ? {} : { text }), ...(group === undefined ? {} : { group }),
  };
}

/** The record of a file suggestion in the editor's text; null when its offsets do not fit the text. */
function toTrackedChange(s: FileSuggestion, fileText: string, length: number): TrackedChange | null {
  const from = fileOffsetToDoc(fileText, s.start);
  const to = s.kind === "delete" ? from : fileOffsetToDoc(fileText, s.end);
  if (from < 0 || to > length || to < from || (s.kind === "insert" && to === from)) { return null; }
  const { id, kind, author, created, text, group } = s;
  return { id, kind, from, to, author, created, ...(text === undefined ? {} : { text }), ...(group === undefined ? {} : { group }) };
}

/** The mounted editor's review: tracking, its view, and the sync with the file's suggestions. */
export interface ReviewSupport {
  extensions: Extension[];
  /** Loads the file's suggestions and opens in the review's mode; returns the stop function. */
  attach(view: EditorView): () => void;
  /** Sends the suggestions recorded or resolved since the last send; call it when the editor's text is the saved file's. */
  saved(): void;
  setMode(mode: ReviewMode): void;
  /** Switches between Editing and Reviewing, telling the host as the dropdown does. */
  toggle(): void;
  dropdown: SourceToolbarDropdown;
}

export interface ReviewSupportDeps {
  lineBreak: string;
  /** The text last written to the file, which the port's offsets are in. */
  savedText(): string;
  /** A shared text has no save the editor sees, so its changes are sent after the autosave delay. */
  shared: boolean;
  logger: ILogger;
}

interface SendState { sent: Map<string, string>; pending: Set<string> }

/** Sends the suggestions to the port, recording each as sent at once and undoing that when the port refuses. */
function pushSuggestions(review: EditorReview, logger: ILogger, state: SendState, added: readonly FileSuggestion[], removed: readonly string[]): void {
  const previous = new Map(state.sent);
  const restore = (id: string): void => { const key = previous.get(id); if (key === undefined) { state.sent.delete(id); } else { state.sent.set(id, key); } };
  for (const s of added) { state.sent.set(s.id, suggestionKey(s)); state.pending.add(s.id); }
  for (const id of removed) { state.sent.delete(id); }
  if (added.length > 0) {
    review.suggestions.add(added)
      .catch((error: unknown) => {
        for (const s of added) { restore(s.id); }
        void logger.error(REVIEW_MODULE, error, { action: "addSuggestions" });
      })
      .finally(() => { for (const s of added) { state.pending.delete(s.id); } });
  }
  if (removed.length > 0) {
    review.suggestions.remove(removed).catch((error: unknown) => {
      for (const id of removed) { restore(id); }
      void logger.error(REVIEW_MODULE, error, { action: "removeSuggestions" });
    });
  }
}

/** The records the list stands for: the editor's own where the list holds what it sent, plus the records not sent yet or still in flight. */
function mergeSuggestions(list: readonly FileSuggestion[], local: ReadonlyMap<string, TrackedChange>, state: SendState, fileText: string, length: number): TrackedChange[] {
  const incoming = new Set(list.map((s) => s.id));
  const next: TrackedChange[] = [];
  for (const s of list) {
    const mine = local.get(s.id);
    // The port's copy of what this editor sent: the local record may have grown since, so it stays.
    if (mine && state.sent.get(s.id) === suggestionKey(s)) { next.push(mine); continue; }
    const record = toTrackedChange(s, fileText, length);
    if (record) { next.push(record); }
  }
  // Records not sent yet, or whose add is still in flight, are missing from the list but not gone.
  for (const change of local.values()) {
    if (!incoming.has(change.id) && (!state.sent.has(change.id) || state.pending.has(change.id))) { next.push(change); }
  }
  return next;
}

interface SuggestionSync {
  readonly loading: boolean;
  /** Sends the records added or changed since the last send, and the removal of those gone. */
  send(): void;
  /** Sends the removal of the sent suggestions the state does not hold. */
  sendRemovals(state: EditorState): void;
  load(list: readonly FileSuggestion[]): void;
}

/** The sync of the editor's records with the port's list. */
function createSuggestionSync(review: EditorReview, tracking: ReviewTracking, deps: Pick<ReviewSupportDeps, "lineBreak" | "savedText" | "logger">, getView: () => EditorView | undefined): SuggestionSync {
  // INVARIANT: sent holds, by id, the version of each suggestion the port has or is being sent; pending, the ids whose add is in flight.
  const state: SendState = { sent: new Map(), pending: new Set() };
  let loading = false;
  const push = (added: readonly FileSuggestion[], removed: readonly string[]): void => pushSuggestions(review, deps.logger, state, added, removed);
  const goneFrom = (ids: ReadonlySet<string>): string[] => [...state.sent.keys()].filter((id) => !ids.has(id));

  const send = (): void => {
    const view = getView();
    if (!view) { return; }
    const { doc } = view.state;
    const current = tracking.changes(view.state).map((change) => toFileSuggestion(change, doc, deps.lineBreak));
    push(current.filter((s) => state.sent.get(s.id) !== suggestionKey(s)), goneFrom(new Set(current.map((s) => s.id))));
  };

  const load = (list: readonly FileSuggestion[]): void => {
    const view = getView();
    if (!view) { return; }
    const local = new Map(tracking.changes(view.state).map((change) => [change.id, change]));
    const next = mergeSuggestions(list, local, state, deps.savedText(), view.state.doc.length);
    const incoming = new Set(list.map((s) => s.id));
    const inFlight = [...state.pending].flatMap((id): [string, string][] => { const key = state.sent.get(id); return key === undefined || incoming.has(id) ? [] : [[id, key]]; });
    state.sent = new Map([...list.map((s): [string, string] => [s.id, suggestionKey(s)]), ...inFlight]);
    loading = true;
    try { tracking.load(view, next); } finally { loading = false; }
  };

  return {
    get loading() { return loading; },
    send,
    sendRemovals: (editor) => push([], goneFrom(new Set(tracking.changes(editor).map((change) => change.id)))),
    load,
  };
}

export function createReviewSupport(review: EditorReview, { lineBreak, savedText, shared, logger }: ReviewSupportDeps): ReviewSupport {
  const tracking = createReviewTracking({ author: review.author });
  const reviewView = createReviewView(tracking);
  let view: EditorView | undefined;
  let mode = review.mode;
  const sync = createSuggestionSync(review, tracking, { lineBreak, savedText, logger }, () => view);
  const sharedSend = createDebouncer(sync.send, AUTO_SAVE_DELAY_MS);

  // An accept changes no text, so its remove goes at once; an edit or a reject waits for the save of its text.
  const listener = EditorView.updateListener.of((update) => {
    if (sync.loading || tracking.changes(update.startState) === tracking.changes(update.state)) { return; }
    if (update.docChanged) { if (shared) { sharedSend.call(); } return; }
    sync.sendRemovals(update.state);
  });

  const setMode = (next: ReviewMode): void => {
    mode = next;
    if (view) { reviewView.setMode(view, next); }
  };

  const pick = (next: ReviewMode): void => { setMode(next); review.onMode?.(next); };

  return {
    extensions: [tracking.extension, reviewView.extension, listener],
    attach(editorView) {
      view = editorView;
      if (mode !== "editing") { reviewView.setMode(editorView, mode); }
      const stop = review.suggestions.subscribe(sync.load);
      // The view stays set: closing the editor saves after this, and that save still sends.
      return () => {
        stop();
        if (shared) { sharedSend.cancel(); sync.send(); }
      };
    },
    saved: sync.send,
    setMode,
    toggle: () => pick(mode === "reviewing" ? "editing" : "reviewing"),
    dropdown: reviewModeDropdown(() => mode, pick),
  };
}
