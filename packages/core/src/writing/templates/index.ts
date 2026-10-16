/** Exports the runtime-neutral template model: manifests and their serializer, path rules, the catalog index, the gallery entry and its filter, and the blank templates. */
export { blankTemplate } from "./blankTemplates.js";
export { parseCatalogIndex } from "./catalogIndex.js";
export type { CatalogBlob, CatalogEntry, CatalogFile, CatalogIndexResult, SkippedEntry } from "./catalogIndex.js";
export { filterTemplates } from "./filterTemplates.js";
export type { TemplateFilter } from "./filterTemplates.js";
export { TEMPLATE_SOURCES } from "./templateEntry.js";
export type { TemplateEntry, TemplateSourceId } from "./templateEntry.js";
export { TEMPLATE_CATEGORIES, TEMPLATE_ENGINES, parseTemplateManifest, readTemplateFields, serializeTemplateManifest } from "./templateManifest.js";
export type { ProjectTemplate, TemplateCategory, TemplateEngine, TemplateManifest, TemplateManifestResult } from "./templateManifest.js";
export { templatePathProblem, templateTreeProblem } from "./templatePaths.js";
export * from "./sources/index.js";
