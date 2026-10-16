/** Exports the Node side of citations: reading a project's sources and writing its labshelf.bib. */
export { projectCitationKeys, updateProjectBibliography } from "./projectBibliography.js";
export type { BibliographyUpdate, CitingProject } from "./projectBibliography.js";
export { DISK_ONLY, projectSources } from "./projectSources.js";
export type { OpenSources, ProjectSource } from "./projectSources.js";
