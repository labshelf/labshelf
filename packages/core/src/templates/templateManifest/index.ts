// Exports the template manifest model: validation, serialization, path and licence rules, and the catalog index reader.
export { isDownloadCount, parseCatalogIndex } from "./catalogIndex.js";
export type { CatalogAsset, CatalogEntry, CatalogFile, CatalogIndexResult, SkippedEntry } from "./catalogIndex.js";
export { isCatalogJsonObject, parseCatalogIndexJson } from "./catalogJson.js";
export { isLicenseExpression } from "./templateLicense.js";
export { TEMPLATE_CATEGORIES, TEMPLATE_ENGINES, parseTemplateManifest, readTemplateFields, serializeTemplateManifest } from "./templateManifest.js";
export type { ProjectTemplate, TemplateCategory, TemplateEngine, TemplateManifest, TemplateManifestResult } from "./templateManifest.js";
export { deriveTemplatePathProblem, deriveTemplateSizeProblem, deriveTemplateStructureProblem, deriveTemplateTreeProblem } from "./templatePaths.js";
