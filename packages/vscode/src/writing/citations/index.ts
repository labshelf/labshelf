// Exports what the rest of the writing feature uses from citations: the editor providers, the citation and backlink data, the project values and the reading list.
export { registerCitationProviders } from "./completion.js";
export { createPaperHover } from "./hover.js";
export { CitationSectionsCache, ProjectBacklinks, type CitationSession, type CitationWorkspace } from "./backlinks.js";
export { registerProjectValues } from "./projectValues.js";
export { ProjectReadingLists, registerReadingListCommands } from "./readingList.js";
