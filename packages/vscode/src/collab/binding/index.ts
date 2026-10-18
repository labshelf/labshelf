/** Exports the binding of open VS Code editors to shared files: edits both ways, own-only undo and peer cursors. */
export { bindDocument, type BindOptions, type DocumentBinding } from "./bindDocument.js";
export { PeerCursors, type PeerCursor } from "./peerCursors.js";
export { RemoteEditQueue } from "./remoteEditQueue.js";
export { overrideUndoRedo, REDO_COMMAND, SHARED_EDITOR_CONTEXT, UNDO_COMMAND, type UndoRedoOverride } from "./undoRedoCommands.js";
