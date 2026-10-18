/** Exports the runtime-neutral backlink API: where a source cites each key, and the index of projects citing a paper built from their sources. */
export { addBacklinks } from "./backlinkIndex.js";
export type { Backlink, BacklinkIndex } from "./backlinkIndex.js";
export { citationSites } from "./citationSites.js";
export type { CitationSite } from "./citationSites.js";
export { sourceHeadings } from "./sourceHeadings.js";
export type { SourceHeading } from "./sourceHeadings.js";
export { projectBacklinks } from "./projectBacklinks.js";
