/** Exports SyncTeX reading: reading and parsing a build's SyncTeX file and mapping between output points and source lines. */
export { parseSynctex } from "./parseSynctex.js";
export { pointFor } from "./pointFor.js";
export { readSynctexFile } from "./readSynctexFile.js";
export { sourceAt } from "./sourceAt.js";
export type { SourceLocation, SyncIndex, SynctexRead } from "./syncIndex.js";
