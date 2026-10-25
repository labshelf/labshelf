// Exports what the source tab needs: the editing operations, the shared-file modes and notices, and the title-bar actions.
export { createSourceUpdates, createFormattingKeymap, deriveSourceLanguage, type SourceUpdates, type SourceLanguage } from "./sourceUpdates";
export { createSourceActions, type SourceActionDeps } from "./actions";
export { readSourceFileMode, type SourceFileMode } from "./sharedFile";
export { mountOnTakeover, openSharedProjectHere } from "./sharedTakeover";
export { renderObservingNotice, renderUnresolvedNotice } from "./readOnlyNotice";
