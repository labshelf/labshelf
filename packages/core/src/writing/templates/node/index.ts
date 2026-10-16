/** Exports the Node side of the template catalog: the on-disk index cache, the Typst Universe and My templates sources, the safe folder reader, saving a project as a template, checking one for submission and validating or indexing a catalog checkout. */
export { createFsTemplateCache } from "./fsTemplateCache.js";
export { createMineSource } from "./mineSource.js";
export type { MineSourceDeps } from "./mineSource.js";
export { readTemplateTree } from "./readTemplateTree.js";
export { saveProjectAsTemplate } from "./saveProjectAsTemplate.js";
export type { SaveTemplateDetails } from "./saveProjectAsTemplate.js";
export { createUniverseSource } from "./universeSource.js";
export type { UniverseSourceDeps } from "./universeSource.js";
export { buildCatalogIndex, validateCatalog } from "./catalog/index.js";
export type { CatalogProblem } from "./catalog/index.js";
export { checkTemplateForPublish } from "./publish/index.js";
export type { PublishBuildResult, PublishCheck, PublishCheckInput, PublishCheckReport, PublishFile } from "./publish/index.js";
