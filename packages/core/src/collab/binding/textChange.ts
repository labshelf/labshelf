// Describes a text change by offsets into the text before it, and reads one from a Y.Text delta.
// ******************************************************************************
// Copied and adapted from open-collaboration-tools (yjs-normalized-text.ts).
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in LICENSE-open-collaboration-tools.md.
// ******************************************************************************

import type * as Y from "yjs";

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
