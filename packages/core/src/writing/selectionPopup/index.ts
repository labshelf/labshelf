/** Exports the selection popup's runtime-neutral parts: what a selection is on, the edits of its actions, its markers and its settings. */
export {
  deriveDisplayMath, deriveExtractPath, deriveIncludeLine, deriveSelectionContext, findLabelOccurrences,
  type CitationPageTarget, type SelectionCitation, type SelectionContext, type SelectionContextOptions, type SelectionInlineMath, type SelectionKind,
  type SelectionReference, type TextReplacement,
} from "./context.js";
export { SELECTION_POPUP_MARKERS } from "./markers.js";
export {
  DEFAULT_SELECTION_POPUP, SELECTION_POPUP_BUTTONS, SELECTION_POPUP_BUTTON_INFO, SELECTION_POPUP_TRIGGERS,
  formatSelectionPopupPrefs, isSameSelectionPopup, listSelectionPopupButtons, parseSelectionPopupMessage, parseSelectionPopupPrefs,
  type SelectionPopupButtonId, type SelectionPopupButtonInfo, type SelectionPopupPrefs, type SelectionPopupTrigger,
} from "./prefs.js";
