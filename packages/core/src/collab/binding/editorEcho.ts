// Recognises an editor change that only echoes an edit the binding itself applied to the editor.
// ******************************************************************************
// Copied and adapted from open-collaboration-tools (yjs-normalized-text.ts).
// Copyright 2025 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in LICENSE-open-collaboration-tools.md.
// ******************************************************************************

import { applyChanges, type TextChange } from "./textChange.js";

/** An edit sent to the editor and not yet settled: the document text it was computed against, and the text it yields. */
export interface ChangeSet {
  before: string;
  after: string;
}

export function isEcho(inFlight: readonly ChangeSet[], changes: readonly TextChange[]): boolean {
  return inFlight.some((changeSet) => applyChanges(changeSet.before, changes) === changeSet.after);
}
