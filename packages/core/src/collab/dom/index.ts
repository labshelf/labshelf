// Exports the project-sharing dialogs and the menu entries that open them, the editor's Yjs binding and its comment marks, gutter and Add comment panel.
export { runJoinProjectDialog, runLeaveProjectDialog, runShareProjectDialog } from "./collabDialogs.js";
export { createProjectShareMenuEntries } from "./projectShareMenu.js";
export { createCollabExtensions, createRemoteCursors, createPeerCursors, type CollabExtensionsOptions, type PeerCursor, type PeerCursorSource } from "./editorCollab.js";
export {
  addCommentSupport, createCommentSupport, mountBodyInput,
  type BodyInput, type CommentSupport, type CommentSupportDeps, type EditorComments, type MountBodyEditor, type RenderCommentFooter,
} from "./editorComments.js";
