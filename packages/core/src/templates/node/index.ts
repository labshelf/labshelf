/** Exports the Node side of the template catalog: the safe folder reader, saving a project as a template, checking one for submission and validating or indexing a catalog checkout. */
export { readTemplateTree } from "./templateFolder.js";
export { writeProjectAsTemplate, writePublishedTemplate } from "./templateWrites.js";
export type { WriteTemplateInput } from "./templateWrites.js";
export { buildCatalogIndex, checkCatalog } from "./catalog.js";
export type { CatalogProblem } from "./catalog.js";
export { checkTemplateForPublish, runSourceChecks } from "./templateChecks.js";
