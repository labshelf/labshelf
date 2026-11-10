// Exports the project-sharing dialogs and the menu entries that open them, the editor's Yjs binding and its comment marks, gutter and Add comment panel.
export { runInviteByEmailDialog, runJoinProjectDialog, runLeaveProjectDialog, runShareProjectDialog } from "./collabDialogs.js";
export { createProjectShareMenuEntries } from "./projectShareMenu.js";
export { createCollabExtensions, createRemoteCursors, createPeerCursors, redoSharedEdit, undoSharedEdit, type CollabExtensionsOptions, type PeerCursor, type PeerCursorSource } from "./editorCollab.js";
export {
  addCommentSupport, createCommentSupport, docOffsetToFile, fileOffsetToDoc,
  type CommentSupport, type CommentSupportDeps, type EditorComments, type RenderCommentFooter,
} from "./editorComments.js";
export { mountBodyInput, type BodyInput, type MountBodyEditor } from "./commentPopover.js";
