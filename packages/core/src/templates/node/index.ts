/** Exports the Node side of the template catalog: the safe folder reader, saving a project as a template, checking one for submission and validating or indexing a catalog checkout. */
export { readTemplateTree } from "./readTemplateTree.js";
export { saveProjectAsTemplate } from "./writeProjectAsTemplate.js";
export type { SaveTemplateDetails } from "./writeProjectAsTemplate.js";
export { buildCatalogIndex, validateCatalog } from "./catalog/index.js";
export type { CatalogProblem } from "./catalog/index.js";
export { checkTemplateForPublish } from "./checkTemplateForPublish.js";
export { runSourceChecks } from "./sourceChecks.js";
export { savePublishedTemplate } from "./writePublishedTemplate.js";
