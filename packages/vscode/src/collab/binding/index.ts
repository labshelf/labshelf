/** Exports the binding of open VS Code editors to shared files: edits both ways, own-only undo and peer cursors. */
export { attachDocument, type AttachOptions, type DocumentBinding } from "./attachDocument.js";
export { PeerCursors, type PeerCursor } from "./peerCursors.js";
export { RemoteUpdateQueue } from "./remoteUpdateQueue.js";
export { registerUndoRedo, type UndoRedoOverride } from "./undoCommands.js";
