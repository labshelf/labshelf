/** Links from manuscript equations back to the notes they came from. */
export { deriveOriginHash, findOriginCommentStart, formatOriginComment, parseOriginComment, type OriginRef } from "./originComment.js";
export { readOriginLatex, scanOrigins, type ManuscriptOrigin } from "./scanOrigins.js";
export { deriveOriginState, type OriginState } from "./originState.js";
export { buildInsert, buildUpdate, diffOrigin, listNoteInsertables, type NoteInsertable, type NoteInsertSource } from "./noteInsertables.js";
