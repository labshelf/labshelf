// Exports the template manifest model: validation, serialization, path and licence rules, and the catalog index reader.
export { parseCatalogIndex } from "./catalogIndex.js";
export type { CatalogBlob, CatalogEntry, CatalogFile, CatalogIndexResult, SkippedEntry } from "./catalogIndex.js";
export { isRecord, parseIndexJson } from "./indexJson.js";
export { isLicenseExpression } from "./licenseExpression.js";
export { TEMPLATE_CATEGORIES, TEMPLATE_ENGINES, parseTemplateManifest, readTemplateFields, serializeTemplateManifest } from "./templateManifest.js";
export type { ProjectTemplate, TemplateCategory, TemplateEngine, TemplateManifest, TemplateManifestResult } from "./templateManifest.js";
export { templatePathProblem, templateTreeProblem } from "./templatePaths.js";
