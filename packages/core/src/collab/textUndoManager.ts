// Undoes and redoes only this user's edits of a shared text, grouped like native editor typing.
// ******************************************************************************
// Copied and adapted from p2p-live-share (src/fs/undo-manager.ts).
// Copyright 2025 _Kerman
// Made available under the terms of the MIT License, which is available in LICENSE-p2p-live-share.md.
// ******************************************************************************

import * as Y from "yjs";

/** Offsets into the Y.Text, not the editor document. */
export interface UndoSelection { anchor: number; active: number }
export interface UndoChange { rangeOffset: number; rangeLength: number; text: string }

interface EditGroup {
  change: UndoChange;
  kind: "insert" | "delete";
  spaces: number;
  direction?: "backward" | "forward" | undefined;
}

const selectionKey = Symbol("selection");

export class TextUndoManager extends Y.UndoManager {
  private selection: { anchor: Y.RelativePosition; active: Y.RelativePosition }[] | undefined;
  private previousChange: EditGroup | undefined;
  private readonly onTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin !== this.localOrigin && transaction.origin !== this && transaction.changed.has(this.text as Y.AbstractType<any>)) {
      this.stopCapturing();
    }
  };

  /** Tracks the transactions whose origin is `localOrigin`: the edits this user makes. */
  constructor(private readonly text: Y.Text, readonly localOrigin: unknown) {
    super(text, { trackedOrigins: new Set([localOrigin]), captureTimeout: 1000 });
    this.doc.on("afterTransaction", this.onTransaction);
    this.on("stack-item-added", ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) => {
      // Keep the selection before the first edit in a group. During undo/redo,
      // the new opposite-stack item captures the current selection instead.
      stackItem.meta.set(selectionKey, this.selection);
    });
    this.on("stack-item-popped", ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) => {
      this.selection = stackItem.meta.get(selectionKey) as typeof this.selection;
    });
  }

  applyChanges(changes: readonly UndoChange[], selections?: readonly UndoSelection[]): void {
    this.captureChanges(changes);
    this.captureSelection(selections);
    this.doc.transact(() => {
      for (const change of changes.slice().sort((a, b) => b.rangeOffset - a.rangeOffset)) {
        this.text.delete(change.rangeOffset, change.rangeLength);
        this.text.insert(change.rangeOffset, change.text);
      }
    }, this.localOrigin);
  }

  // VS Code does not expose its undo boundaries. Merge only adjacent character
  // input/deletion here; replacements, paste and multi-edit operations stand
  // alone. Selection movement and incoming edits also end the current group.
  captureChanges(changes: readonly UndoChange[]): void {
    const change = changes.length === 1 ? changes[0] : undefined;
    const kind = editKind(change);
    const previous = this.previousChange;
    let continuous = false;
    let direction: EditGroup["direction"];
    let spaces = 0;
    if (change && previous && kind === previous.kind) {
      if (kind === "insert") {
        continuous = change.rangeOffset === previous.change.rangeOffset + previous.change.text.length;
        spaces = change.text === " " ? previous.spaces + 1 : 0;
        // Match the common native typing behavior: start a group at the first
        // space, then include the following word; repeated spaces end a group.
        if ((spaces === 1 && previous.spaces === 0) || (spaces === 0 && previous.spaces > 1)) { continuous = false; }
      } else {
        direction = change.rangeOffset === previous.change.rangeOffset
          ? "forward"
          : change.rangeOffset + change.rangeLength === previous.change.rangeOffset ? "backward" : undefined;
        continuous = direction !== undefined && (!previous.direction || direction === previous.direction);
      }
    } else if (change?.text === " ") {
      spaces = 1;
    }
    if (!continuous) { this.stopCapturing(); }
    this.previousChange = change && kind ? { change, kind, spaces, direction } : undefined;
  }

  override stopCapturing(): void {
    super.stopCapturing();
    this.previousChange = undefined;
  }

  override destroy(): void {
    this.doc.off("afterTransaction", this.onTransaction);
    super.destroy();
  }

  captureSelection(selections?: readonly UndoSelection[]): void {
    this.selection = selections?.map(({ anchor, active }) => ({
      anchor: Y.createRelativePositionFromTypeIndex(this.text, anchor),
      active: Y.createRelativePositionFromTypeIndex(this.text, active),
    }));
  }

  restoreSelection(): UndoSelection[] | undefined {
    const selections = this.selection?.map(({ anchor, active }) => ({
      anchor: Y.createAbsolutePositionFromRelativePosition(anchor, this.doc)?.index,
      active: Y.createAbsolutePositionFromRelativePosition(active, this.doc)?.index,
    }));
    if (selections?.every((s) => s.anchor !== undefined && s.active !== undefined)) {
      return selections as UndoSelection[];
    }
    return undefined;
  }
}

function editKind(change: UndoChange | undefined): EditGroup["kind"] | undefined {
  if (change && change.rangeLength === 0 && change.text.length <= 2 && Array.from(change.text).length === 1
    && !/[\r\n\t]/.test(change.text)) {
    return "insert";
  }
  return change && change.text === "" && change.rangeLength === 1 ? "delete" : undefined;
}
