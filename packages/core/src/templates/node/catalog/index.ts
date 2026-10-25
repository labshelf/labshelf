/** Exports validating a template catalog checkout, building its index.json and the preview limits a submission must meet. */
export { SAMPLE_MAX_BYTES, THUMBNAIL_MAX_BYTES } from "./catalogLimits.js";
export { buildCatalogIndex } from "./buildCatalogIndex.js";
export type { CatalogProblem } from "./loadCatalog.js";
export { checkCatalog } from "./checkCatalog.js";
export { deriveThumbnailProblem } from "./deriveThumbnailProblem.js";
