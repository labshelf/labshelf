// Keeps an editor document and a shared Y.Text in step both ways, across CRLF line ends and edit echoes.
// ******************************************************************************
// Copied and adapted from open-collaboration-tools (yjs-normalized-text.ts).
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in LICENSE-open-collaboration-tools.md.
// ******************************************************************************
import type * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { TextUndoManager, UndoChange } from "./textUndoManager.js";

/** Every change of one set refers to offsets of the same text, the one before the whole set. */
export interface TextChange {
  start: number;
  end: number;
  text: string;
}

type TextDelta = Y.YTextEvent["delta"][number];

/** Most algorithms that use a change set expect ascending start offsets. */
export function orderChanges(changes: readonly TextChange[]): TextChange[] {
  return [...changes].sort((a, b) => a.start - b.start);
}

export function deriveChangesFromDelta(delta: readonly TextDelta[]): TextChange[] {
  const changes: TextChange[] = [];
  let index = 0;
  for (const op of delta) {
    if (typeof op.retain === "number") {
      index += op.retain;
    } else if (typeof op.insert === "string") {
      changes.push({ start: index, end: index, text: op.insert });
    } else if (typeof op.delete === "number") {
      changes.push({ start: index, end: index + op.delete, text: "" });
      // The receiver applies every following op to the text before the delete, so the index keeps counting it.
      index += op.delete;
    }
  }
  return changes;
}

export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let result = text;
  let delta = 0;
  for (const { start, end, text: inserted } of orderChanges(changes)) {
    result = result.substring(0, start + delta) + inserted + result.substring(end + delta);
    delta += inserted.length - (end - start);
  }
  return result;
}

type Bias = "before" | "after";

/** Where `offset` lands once `changes` (sorted, all on one text) are applied; `bias` settles an offset at an insert point or inside a replaced range. */
function mapOffset(offset: number, changes: readonly TextChange[], bias: Bias): number {
  let delta = 0;
  for (const change of changes) {
    if (change.start > offset) { break; }
    if (change.end < offset || (change.end === offset && change.start < offset)) {
      delta += change.text.length - (change.end - change.start);
      continue;
    }
    return change.start + delta + (bias === "after" ? change.text.length : 0);
  }
  return offset + delta;
}

/** A range keeps the other side's inserts at its edges, so neither side deletes text it never saw. */
function rebaseChanges(changes: readonly TextChange[], over: readonly TextChange[], insertBias: Bias): TextChange[] {
  return orderChanges(changes).map(({ start, end, text }) => {
    if (start === end) {
      const at = mapOffset(start, over, insertBias);
      return { start: at, end: at, text };
    }
    const mappedStart = mapOffset(start, over, "after");
    return { start: mappedStart, end: Math.max(mappedStart, mapOffset(end, over, "before")), text };
  });
}

/** One replacement that turns `from` into `to`; it never splits a CRLF pair. */
export function deriveReplacementBetween(from: string, to: string): TextChange {
  const shorter = Math.min(from.length, to.length);
  let prefix = 0;
  while (prefix < shorter && from.charCodeAt(prefix) === to.charCodeAt(prefix)) { prefix++; }
  let suffix = 0;
  while (suffix < shorter - prefix
    && from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix)) { suffix++; }
  if (prefix > 0 && from.charCodeAt(prefix - 1) === CARRIAGE_RETURN) { prefix--; }
  if (suffix > 0 && from.charCodeAt(from.length - suffix - 1) === CARRIAGE_RETURN) { suffix--; }
  return { start: prefix, end: from.length - suffix, text: to.slice(prefix, to.length - suffix) };
}

/** INVARIANT: applying every set in order to the editor text gives the target text. */
export class PendingRemoteChanges {
  private sets: TextChange[][] = [];

  get head(): readonly TextChange[] | undefined {
    return this.sets[0];
  }

  push(changes: readonly TextChange[]): void {
    if (changes.length > 0) { this.sets.push(orderChanges(changes)); }
  }

  /** The head set reached the editor. */
  shift(): void {
    this.sets.shift();
  }

  /** Replaces the sets by one replacement, for when the exact remote changes are unknown. */
  reset(editorText: string, targetText: string): void {
    this.sets = editorText === targetText ? [] : [[deriveReplacementBetween(editorText, targetText)]];
  }

  /** Moves `local`, made on the editor text before them, over the pending sets; returns it as changes to the target text. */
  rebase(local: readonly TextChange[], editorAfter: string, targetBefore: string): TextChange[] {
    let moving = orderChanges(local);
    const rebased: TextChange[][] = [];
    for (const set of this.sets) {
      // Remote text sits before local text typed at the same point, on both sides.
      rebased.push(rebaseChanges(set, moving, "before"));
      moving = rebaseChanges(moving, set, "after");
    }
    const targetAfter = applyChanges(targetBefore, moving);
    this.sets = rebased;
    // TRAP: moving overlapping ranges past each other does not always converge; the replacement does.
    if (this.sets.reduce(applyChanges, editorAfter) !== targetAfter) { this.reset(editorAfter, targetAfter); }
    return moving;
  }
}

const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;

interface NormalizedLineOffset {
  normalized: number;
  offset: number;
}

const isEOL = (char: number): boolean => char === CARRIAGE_RETURN || char === LINE_FEED;

function normalizeLineEnds(text: string, withCR: boolean): string {
  return text.replace(/\r?\n/g, withCR ? "\r\n" : "\n");
}

/**
 * Counts the LF-only offsets of `start` and `end` in `text` by scanning it, for use while the
 * text is being edited and no map of it exists. It is called about once per edit.
 */
function countNormalizedOffsets(text: string, start: number, end: number): [number, number] {
  let normalizedStart = 0;
  let normalizedEnd = 0;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) !== CARRIAGE_RETURN) {
      if (i < start) { normalizedStart++; }
      normalizedEnd++;
    }
  }
  return [normalizedStart, normalizedEnd];
}

function computeNormalizedLineOffsets(text: string): NormalizedLineOffset[] {
  const result: NormalizedLineOffset[] = [{ normalized: 0, offset: 0 }];
  let normalizationOffset = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (isEOL(ch)) {
      if (ch === CARRIAGE_RETURN && i + 1 < text.length && text.charCodeAt(i + 1) === LINE_FEED) {
        i++;
        normalizationOffset++;
      }
      const offset = i + 1;
      result.push({ normalized: offset - normalizationOffset, offset });
    }
  }
  return result;
}

class LineOffsetMap {
  private readonly lines: NormalizedLineOffset[];

  constructor(text: string) {
    this.lines = computeNormalizedLineOffsets(text);
  }

  toDocumentOffset(normalizedOffset: number): number {
    const line = this.findLine(normalizedOffset, "normalized");
    return line.offset + normalizedOffset - line.normalized;
  }

  toNormalizedOffset(offset: number): number {
    const line = this.findLine(offset, "offset");
    return line.normalized + offset - line.offset;
  }

  private findLine(offset: number, key: keyof NormalizedLineOffset): NormalizedLineOffset {
    let low = 0;
    let high = this.lines.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.lines[mid]![key] > offset) { high = mid; } else { low = mid + 1; }
    }
    // INVARIANT: the first line starts at 0 and offsets are not negative, so low is at least 1.
    // low is the first line that starts after the offset, so the offset lies on the line before it.
    return this.lines[low - 1]!;
  }
}

/** An edit sent to the editor and not yet settled: the document text it was computed against, and the text it yields. */
interface ChangeSet {
  before: string;
  after: string;
}

function isEcho(inFlight: readonly ChangeSet[], changes: readonly TextChange[]): boolean {
  return inFlight.some((changeSet) => applyChanges(changeSet.before, changes) === changeSet.after);
}

const LOG_MODULE = "collab.binding";

/** A selection by document offsets; `active` is where the caret is. */
export interface EditorSelection { anchor: number; active: number }

/** Changes to send to the editor, against the document text they were computed from; `settle` once the editor answered. */
export interface PendingChange {
  readonly changes: readonly TextChange[];
  settle(): void;
}

/**
 * Offsets of `text` are document offsets (CRLF counts two); offsets of the Y.Text are normalized
 * (LF only). INVARIANT: the editor text with the pending remote changes applied is `text`.
 */
export class NormalizedText {
  private text: string;
  private editorText: string;
  private map: LineOffsetMap | undefined;
  private readonly inFlight: ChangeSet[] = [];
  private readonly pending = new PendingRemoteChanges();
  /** See {@link attachLocalDocument}. */
  private diverged = false;
  private readonly doc: Y.Doc;
  private readonly observer = (event: Y.YTextEvent) => this.observe(event);

  /** `onRemoteChanges` runs whenever the editor should show text it does not have; it then asks {@link nextEdit}. */
  constructor(
    private readonly yText: Y.Text,
    private readonly undo: TextUndoManager,
    private readonly onRemoteChanges: () => void,
    private readonly logger: ILogger,
  ) {
    if (!yText.doc) { throw new Error("A normalized text needs a Y.Text that belongs to a Y.Doc"); }
    this.doc = yText.doc;
    this.text = this.editorText = yText.toString();
    yText.observe(this.observer);
  }

  /**
   * Declares what the editor currently holds, which is not necessarily the content of the shared
   * Y.Text: it is still empty while the file has not been seeded, and the seed then arrives as
   * "insert the whole file at offset 0" — applied incrementally that shows the content twice.
   * A non-empty Y.Text is authoritative, so it is reconciled against right away. An empty one means
   * "not shared yet": the local content stands until the first remote update, which then reconciles.
   */
  attachLocalDocument(localText: string): void {
    const shared = this.yText.toString();
    this.setText(localText);
    this.editorText = localText;
    this.pending.reset(localText, localText);
    // Compare in LF space: the local document may use CRLF, the shared one never does.
    this.diverged = normalizeLineEnds(localText, false) !== normalizeLineEnds(shared, false);
    if (this.diverged && shared.length > 0) { this.reconcile(); }
  }

  /** Feeds in a change the editor reports, against its text before the change; `selections` are those before it. */
  applyLocalChanges(changes: readonly TextChange[], selections?: readonly EditorSelection[]): void {
    const editorBefore = this.editorText;
    this.editorText = applyChanges(editorBefore, changes);
    if (isEcho(this.inFlight, changes)) {
      const head = this.pending.head;
      if (head && applyChanges(editorBefore, head) === this.editorText) { this.pending.shift(); } else { this.pending.reset(this.editorText, this.text); }
      return;
    }
    if (this.diverged) {
      // Not shared yet: the editor's text stands and has nowhere to go.
      this.setText(this.editorText);
      return;
    }
    if (this.pending.head) {
      // Selections between remote changes the editor has not shown yet have no exact place; undo then keeps the caret.
      this.write(this.pending.rebase(changes, this.editorText, this.text), undefined);
    } else {
      this.write(orderChanges(changes), selections);
    }
  }

  /** The next edit that brings `documentText`, the editor's current text, closer to the shared text. */
  nextEdit(documentText: string): PendingChange | undefined {
    if (documentText !== this.editorText) {
      void this.logger.log("WARN", LOG_MODULE, "The editor changed without reporting it; sharing the difference as a local edit", {
        expectedLength: this.editorText.length, actualLength: documentText.length,
      });
      this.applyLocalChanges([deriveReplacementBetween(this.editorText, documentText)]);
    }
    const changes = this.pending.head;
    if (!changes) { return undefined; }
    const changeSet: ChangeSet = { before: documentText, after: applyChanges(documentText, changes) };
    this.inFlight.push(changeSet);
    return {
      changes,
      settle: () => {
        const index = this.inFlight.indexOf(changeSet);
        if (index !== -1) { this.inFlight.splice(index, 1); }
      },
    };
  }

  toNormalizedOffset(offset: number): number {
    return this.lineMap().toNormalizedOffset(offset);
  }

  toDocumentOffset(normalizedOffset: number): number {
    return this.lineMap().toDocumentOffset(normalizedOffset);
  }

  dispose(): void {
    this.yText.unobserve(this.observer);
  }

  private observe(event: Y.YTextEvent): void {
    // TRAP: only the binding's own writes are skipped. Undo and redo are local transactions too
    // (origin = the undo manager) and must reach the editor, as must edits from disk.
    if (event.transaction.origin === this.undo.localOrigin) { return; }
    if (this.diverged) {
      this.reconcile();
      return;
    }
    const hasCR = this.text.includes("\r");
    const map = this.lineMap();
    const changes = deriveChangesFromDelta(event.delta).map((change) => ({
      start: map.toDocumentOffset(change.start),
      end: map.toDocumentOffset(change.end),
      text: normalizeLineEnds(change.text, hasCR),
    }));
    this.setText(applyChanges(this.text, changes));
    this.pending.push(changes);
    this.onRemoteChanges();
  }

  /** Replaces the editor's content by the shared one, as a delta does not apply to a text it shares no base with. */
  private reconcile(): void {
    this.diverged = false;
    const before = this.text;
    const after = normalizeLineEnds(this.yText.toString(), before.includes("\r"));
    // Both sides agree in the common case, as both read the same file.
    if (after === before) { return; }
    this.setText(after);
    this.pending.reset(this.editorText, after);
    this.onRemoteChanges();
  }

  /** Writes changes to `text` (sorted) into the Y.Text as one transaction this user can undo. */
  private write(changes: readonly TextChange[], selections: readonly EditorSelection[] | undefined): void {
    const map = this.lineMap();
    const normalizedSelections = selections?.map(({ anchor, active }) => ({
      anchor: map.toNormalizedOffset(anchor), active: map.toNormalizedOffset(active),
    }));
    this.doc.transact(() => {
      let text = this.text;
      let delta = 0;
      const undoChanges: UndoChange[] = [];
      for (const change of changes) {
        const start = change.start + delta;
        const end = change.end + delta;
        const [normalizedStart, normalizedEnd] = countNormalizedOffsets(text, start, end);
        text = text.substring(0, start) + change.text + text.substring(end);
        delta += change.text.length - (end - start);
        const inserted = normalizeLineEnds(change.text, false);
        this.yText.delete(normalizedStart, normalizedEnd - normalizedStart);
        this.yText.insert(normalizedStart, inserted);
        undoChanges.push({ rangeOffset: normalizedStart, rangeLength: normalizedEnd - normalizedStart, text: inserted });
      }
      // Inside the transaction: the undo manager groups it when the transaction ends.
      this.undo.captureChanges(undoChanges);
      this.undo.captureSelection(normalizedSelections);
      this.setText(text);
    }, this.undo.localOrigin);
  }

  private setText(text: string): void {
    this.text = text;
    this.map = undefined;
  }

  private lineMap(): LineOffsetMap {
    this.map ??= new LineOffsetMap(this.text);
    return this.map;
  }
}
