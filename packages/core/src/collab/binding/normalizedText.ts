// Keeps an editor document and a shared Y.Text in step both ways, across CRLF line ends and edit echoes.
// ******************************************************************************
// Copied and adapted from open-collaboration-tools (yjs-normalized-text.ts).
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in LICENSE-open-collaboration-tools.md.
// ******************************************************************************

import type * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import { isEcho, type ChangeSet } from "./editorEcho.js";
import { countNormalizedOffsets, LineOffsetMap, normalizeLineEnds } from "./lineOffsets.js";
import { PendingRemoteChanges, replacementBetween } from "./pendingRemoteChanges.js";
import { applyChanges, changesFromDelta, sortChanges, type TextChange } from "./textChange.js";
import type { TextUndoManager, UndoChange } from "./textUndoManager.js";

const LOG_MODULE = "collab.binding";

/** A selection by document offsets; `active` is where the caret is. */
export interface EditorSelection { anchor: number; active: number }

/** Changes to send to the editor, against the document text they were computed from; `settle` once the editor answered. */
export interface PendingEdit {
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
      this.write(sortChanges(changes), selections);
    }
  }

  /** The next edit that brings `documentText`, the editor's current text, closer to the shared text. */
  nextEdit(documentText: string): PendingEdit | undefined {
    if (documentText !== this.editorText) {
      void this.logger.log("WARN", LOG_MODULE, "The editor changed without reporting it; sharing the difference as a local edit", {
        expectedLength: this.editorText.length, actualLength: documentText.length,
      });
      this.applyLocalChanges([replacementBetween(this.editorText, documentText)]);
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
    const changes = changesFromDelta(event.delta).map((change) => ({
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
