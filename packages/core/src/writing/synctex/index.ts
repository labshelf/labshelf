/** Exports SyncTeX reading: reading and parsing a build's SyncTeX file and mapping between output points and source lines. */
export { parseSynctex } from "./parseSynctex.js";
export { findPagePoint } from "./findPagePoint.js";
export { readSynctexFile } from "./readSynctexFile.js";
export { findSourcePosition } from "./findSourcePosition.js";
export type { SourcePosition, SynctexMap, SynctexRead } from "./synctexMap.js";
