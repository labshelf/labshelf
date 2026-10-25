// Exports the page's comment support: marks and the Add comment action in the editor, the thread store over comments.json and its routing to a share's live threads.
export { commentSupport, type EditorComments } from "./commentSupport";
export { createCommentThreads } from "./commentThreads";
export { createRoutedCommentThreads } from "./routedCommentThreads";
export type { CommentThreads, ReviewThread } from "./commentThreads";
