/** Exports the source editor's typing helpers: their ids and switches, the context scanner, the edits they make and the shared editor-prefs.json. */
export {
  DEFAULT_TYPING_HELPERS, TYPING_HELPER_IDS, TYPING_HELPER_INFO, isSameTypingHelpers, listTypingHelpers, parseTypingHelpers,
  type TypingHelperId, type TypingHelperInfo, type TypingHelpers, type TypingLanguage,
} from "./helpers.js";
export { deriveTypingContext, scanTypingContext, type TypingContext, type TypingScan } from "./context.js";
export {
  deriveBackspaceEdit, deriveBeginEndEdit, deriveEnterEdit, deriveTypedEdit, isClosingAllowed, isEscapedAt,
  type AutoCloserCheck, type TypingChange, type TypingEdit,
} from "./edits.js";
export { EditorPrefsStore, parseEditorPrefs, serializeEditorPrefs, type EditorPrefs, type EditorPrefsPort } from "./editorPrefs.js";
