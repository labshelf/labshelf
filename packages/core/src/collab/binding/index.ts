/** Exports the binding of an editor document to a shared Y.Text: edits both ways, own-only undo and peer selections. */
export { NormalizedText, type EditorSelection, type PendingEdit } from "./normalizedText.js";
export { peerColour } from "./peerColour.js";
export { toAbsoluteSelection, toRelativeSelection, type RelativeSelection, type TextSelection } from "./relativeSelection.js";
export type { TextChange } from "./textChange.js";
export { TextUndoManager, type UndoSelection } from "./textUndoManager.js";
