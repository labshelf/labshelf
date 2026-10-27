// Exports the template manifest model: validation, serialization, path and licence rules, and the catalog index reader.
export { isDownloadCount, parseCatalogIndex, parseCatalogIndexJson } from "./catalogIndex.js";
export type { CatalogAsset, CatalogEntry, CatalogFile, CatalogIndexResult, SkippedEntry } from "./catalogIndex.js";
export { TEMPLATE_CATEGORIES, TEMPLATE_ENGINES, isLicenseExpression, parseTemplateManifest, readTemplateFields, serializeTemplateManifest } from "./templateManifest.js";
export type { ProjectTemplate, TemplateKind, TemplateEngine, TemplateManifest, TemplateManifestResult } from "./templateManifest.js";
export { comparePaths, deriveTemplatePathProblem, deriveTemplateSizeProblem, deriveTemplateStructureProblem, deriveTemplateTreeProblem } from "./templatePaths.js";
