/** Exports the review note the build preview adds to the desktop's comment controller and the suggestion store the LabShelf editor reads, which keep collaboration out of web-safe code. */
export { addSourceComment, currentSourceFileComments, type SourceFileComments } from "./comments.js";
export { currentSourceFileSuggestions, type SourceFileSuggestions } from "./suggestions.js";
