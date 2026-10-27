/** Exports the runtime-neutral template model: manifests and their serializer, path rules, the catalog index, the gallery entry and its filter, the blank templates, the library-backed My templates source and index cache, the download count, the gallery protocol, the gallery host, and the GitHub client that publishes a template. */
export { createBlankTemplate, countDownloads, deriveEngineProblem, deriveFilteredTemplates, orderTemplates, TEMPLATE_SOURCES } from "./templateCatalog.js";
export type { AvailableEngines, TemplateEntry, TemplateFilter, TemplateSort, TemplateSourceId } from "./templateCatalog.js";
export { TEMPLATE_CATEGORIES, TEMPLATE_ENGINES, isLicenseExpression, parseCatalogIndex, parseTemplateManifest, readTemplateFields, serializeTemplateManifest, deriveTemplatePathProblem, deriveTemplateTreeProblem } from "./templateManifest/index.js";
export type { CatalogAsset, CatalogEntry, CatalogFile, CatalogIndexResult, ProjectTemplate, SkippedEntry, TemplateKind, TemplateEngine, TemplateManifest, TemplateManifestResult } from "./templateManifest/index.js";
export { CATEGORY_LABELS, ENGINE_LABELS, FORMAT_LABELS, SOURCE_LABELS, formatTemplateByLine, formatTemplateMetaLine, formatTemplateUsesCount, formatTemplateUsesLabel, PUBLISH_CHECK_IDS, publishCheckLabel } from "./templateLabels.js";
export type { PublishBuildResult, PublishCheck, PublishCheckId, PublishCheckInput, PublishCheckReport, PublishFile } from "./templateLabels.js";
export * from "./sources/index.js";
export * from "./host/index.js";
