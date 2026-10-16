/** Exports the runtime-neutral template model: manifests and their serializer, path rules, the catalog index, the gallery entry and its filter, the blank templates, and the gallery protocol. */
export { blankTemplate } from "./blankTemplates.js";
export { TEMPLATE_CATEGORIES, TEMPLATE_ENGINES, isLicenseExpression, parseCatalogIndex, parseTemplateManifest, readTemplateFields, serializeTemplateManifest, templatePathProblem, templateTreeProblem } from "./manifest/index.js";
export type { CatalogBlob, CatalogEntry, CatalogFile, CatalogIndexResult, ProjectTemplate, SkippedEntry, TemplateCategory, TemplateEngine, TemplateManifest, TemplateManifestResult } from "./manifest/index.js";
export { engineProblem } from "./engineProblem.js";
export type { AvailableEngines } from "./engineProblem.js";
export { filterTemplates } from "./filterTemplates.js";
export type { TemplateFilter } from "./filterTemplates.js";
export { CATEGORY_LABELS, ENGINE_LABELS, FORMAT_LABELS, SOURCE_LABELS, templateByLine, templateMetaLine } from "./templateLabels.js";
export { PUBLISH_CHECK_IDS, publishCheckLabel } from "./publishCheckLabels.js";
export type { PublishCheckId } from "./publishCheckLabels.js";
export { TEMPLATE_SOURCES } from "./templateEntry.js";
export type { TemplateEntry, TemplateSourceId } from "./templateEntry.js";
export * from "./sources/index.js";
export * from "./protocol/index.js";
