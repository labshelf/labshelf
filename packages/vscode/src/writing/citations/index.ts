// Exports the citation providers that let a writing project cite library papers from the editor.
export { registerCitationProviders } from "./registerCitationProviders.js";
export type { CitationSession, CitationWorkspace } from "./citationWorkspace.js";
export { CitationSectionsCache } from "./citationSectionsCache.js";
export type { CitationSections, CitationSectionsCacheDeps } from "./citationSectionsCache.js";
export { createPaperHover } from "./hover/index.js";
export { openEditorSources } from "./openEditorSources.js";
export { ProjectBacklinkIndex } from "./projectBacklinkEntries.js";
export { registerCitationFromLibrary } from "./citationFromLibrary.js";
