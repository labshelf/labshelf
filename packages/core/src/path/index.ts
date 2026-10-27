/** Exports path math over the PathOps port, the relative-path check and the LibraryPath and ProjectPath guards. */
export { posixPathOps } from "./pathOps.js";
export type { PathOps } from "./pathOps.js";
export { checkRelativePath } from "./relativePath.js";
export { isLibraryPath, isProjectPath, type LibraryPath, type ProjectPath } from "./brands.js";
export { baseName, extensionOf, stemOf } from "./pathStrings.js";
