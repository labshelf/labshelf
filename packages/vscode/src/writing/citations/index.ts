// Exports the citation providers that let a writing project cite library papers from the editor.
export { registerCitationProviders } from "./registerCitationProviders.js";
export type { CitationSession, CitationWorkspace } from "./citationWorkspace.js";
export { CiteSectionsCache } from "./citationSectionsCache.js";
export type { CiteSections, CiteSectionsCacheDeps } from "./citationSectionsCache.js";
export { paperHover } from "./hover/index.js";
export { openEditorSources } from "./openEditorSources.js";
export { ProjectBacklinkIndex } from "./projectBacklinkEntries.js";
export { registerCiteFromLibrary } from "./citationFromLibrary.js";
