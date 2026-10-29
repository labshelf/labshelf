// Exports what the rest of the writing feature uses from citations: the editor providers and actions, and the citation and backlink data.
export { registerCitationProviders } from "./completion.js";
export { createPaperHover } from "./hover.js";
export { CitationSectionsCache, ProjectBacklinks, type CitationSession, type CitationWorkspace } from "./backlinks.js";
export { registerEditorActions, registerInsertActions, registerPaperLinks } from "./editing.js";
export { registerNoteLens } from "./noteLens.js";
