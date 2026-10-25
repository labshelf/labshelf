// Exports what the source tab needs: the editing operations, the shared-file modes and notices, and the title-bar actions.
export { createSourceEdits, formattingKeymap, sourceLanguageOf, type SourceEdits, type SourceLanguage } from "./sourceUpdates";
export { sourceActions, type SourceActionDeps } from "./actions";
export { sourceFileMode, type SourceFileMode } from "./sharedFile";
export { remountOnTakeover, takeSharedProjectHere } from "./sharedTakeover";
export { observingNotice, unresolvedNotice } from "./readOnlyNotice";
