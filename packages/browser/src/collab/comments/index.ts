// Exports the page's comment support: marks and the Add comment action in the editor, the thread store over comments.json and its routing to a share's live threads.
export { createCommentSupport, type EditorComments } from "./createCommentSupport";
export { createCommentThreads } from "./commentThreads";
export { createRoutedCommentThreads } from "./routedCommentThreads";
export type { CommentThreads, LocatedThread } from "./commentThreads";
