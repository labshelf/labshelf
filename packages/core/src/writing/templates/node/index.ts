/** Exports the Node side of the template catalog: the on-disk index cache, the Typst Universe and My templates sources, the safe folder reader and saving a project as a template. */
export { createFsTemplateCache } from "./fsTemplateCache.js";
export { createMineSource } from "./mineSource.js";
export type { MineSourceDeps } from "./mineSource.js";
export { readTemplateTree } from "./readTemplateTree.js";
export { saveProjectAsTemplate } from "./saveProjectAsTemplate.js";
export type { SaveTemplateDetails } from "./saveProjectAsTemplate.js";
export { createUniverseSource } from "./universeSource.js";
export type { UniverseSourceDeps } from "./universeSource.js";
