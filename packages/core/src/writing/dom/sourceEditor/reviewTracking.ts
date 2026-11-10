/** Review tracking: records the user's edits in Reviewing as tracked changes (D4) and accepts or rejects them. */
import { Annotation, type AnnotationType, Compartment, EditorState, Facet, StateEffect, type StateEffectType, StateField, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ySyncAnnotation } from "y-codemirror.next";
import type { ReviewMode } from "../../../index.js";
import { fromDisk } from "./openEditors.js";

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
