/** Exports a project's comment threads: comments.json on disk, the comments map of a share, and anchoring to text. */
export { type Comment, type CommentAnchor, type CommentThread } from "./commentThread.js";
export {
  addThread, COMMENTS_PATH, deriveCommentThreads, parseCommentsFile, addThreadReply, serializeCommentsFile, setThreadResolved,
  type CommentsDocument,
} from "./commentsFile.js";
export { updateCommentsDocument, loadCommentsDocument, type CommentsFileAccess } from "./commentsFileStore.js";
export { deriveAnchor, deriveLiveAnchor, type TextRange } from "./commentAnchor.js";
export { findThread } from "./findThread.js";
export { addLiveThread, readLiveThreads, addLiveThreadReply, setLiveThreadResolved } from "./liveComments.js";
export { createSharedProjectComments, type SharedProjectComments } from "./createSharedProjectComments.js";
export { importCommentsFile, renderCommentsFile } from "./commentsFileSync.js";
