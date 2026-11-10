/** Review mode: records the user's edits in Reviewing as tracked changes (D4), accepts or rejects them, and keeps the file's suggestion list in step. */
export { createReviewTracking, reviewEdit, type ReviewTracking, type TrackedChange } from "./reviewTracking.js";
export { createReviewSupport, type EditorReview, type EditorSuggestions, type FileSuggestion, type ReviewMode, type ReviewSupport, type ReviewSupportDeps } from "./reviewSupport.js";
