/** Exports the runtime-neutral values API: JSON leaves, reading the listed value files, the generated macro file, its main-file line and source lookups. */
export { readProjectValues } from "./readProjectValues.js";
export { flattenValues } from "./projectValueLeaves.js";
export type { FlattenedValues, LeafValue, ValueLeaf, ValueProject } from "./projectValueLeaves.js";
export { valueMembers } from "./projectValueMembers.js";
export type { ValueMember } from "./projectValueMembers.js";
export { VALUES_FILE_NAME, VALUES_HEADER, generateValuesFile, valueFilePath } from "./projectValueFile.js";
export { withValuesInput } from "./projectValueInputLine.js";
export type { ValuesInputResult } from "./projectValueInputLine.js";
export { latexKeyStart, latexValueAt } from "./latexProjectValueReference.js";
export type { LatexValueReference } from "./latexProjectValueReference.js";
export { typstValueAt, typstValuePrefix } from "./typstProjectValueReference.js";
export type { TypstValuePrefix, TypstValueReference } from "./typstProjectValueReference.js";
