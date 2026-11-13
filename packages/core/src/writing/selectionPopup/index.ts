/** Exports the selection popup's runtime-neutral parts: what a selection is on, the edits of its actions, its markers and its settings. */
export {
  deriveDisplayMath, deriveExtractPath, deriveIncludeLine, deriveInsertContext, deriveListItem, deriveSelectionContext, deriveTableRow, findLabelOccurrences,
  type CursorInsert, type InsertContext,
  type CitationPageTarget, type SelectionCitation, type SelectionContext, type SelectionContextOptions, type SelectionInlineMath, type SelectionKind,
  type SelectionReference, type TextReplacement,
} from "./context.js";
export { deriveInsertGaps, type InsertGap } from "./gaps.js";
export { SELECTION_POPUP_MARKERS } from "./markers.js";
export { SELECTION_POPUP_INSERTS, type InsertDefinition, type InsertHostAction, type InsertRun } from "./inserts.js";
export {
  DEFAULT_NOTE_POPUP, DEFAULT_SELECTION_POPUP, EDITOR_POPUP_DEFAULTS, SELECTION_POPUP_BUTTONS, SELECTION_POPUP_BUTTON_INFO, SELECTION_POPUP_TRIGGERS,
  formatSelectionPopupPrefs, isSameSelectionPopup, listSelectionPopupButtons, parseSelectionPopupMessage, parseSelectionPopupPrefs,
  type EditorPopupKey, type SelectionPopupButtonId, type SelectionPopupButtonInfo, type SelectionPopupPrefs, type SelectionPopupTrigger,
} from "./prefs.js";
