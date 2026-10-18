/** Exports a project's comment threads: comments.json on disk, the comments map of a share, and anchoring to text. */
export { type Comment, type CommentAnchor, type CommentThread } from "./commentThread.js";
export {
  addThread, COMMENTS_PATH, commentThreads, parseCommentsFile, replyToThread, serializeCommentsFile, setThreadResolved,
  type CommentsDocument,
} from "./commentsFile.js";
export { anchorFor, liveAnchorFor, type TextRange } from "./commentAnchor.js";
export { locateThread } from "./locateThread.js";
export { addLiveThread, liveThreads, replyToLiveThread, setLiveThreadResolved } from "./liveComments.js";
export { importCommentsFile, renderCommentsFile } from "./commentsFileSync.js";
