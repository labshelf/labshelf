/** Exports SyncTeX reading: reading and parsing a build's SyncTeX file and mapping between output points and source lines. */
export { parseSynctex, readSynctexFile } from "./synctexFile.js";
export { findPagePoint, findSourcePosition } from "./synctexLookup.js";
export type { SourcePosition, SynctexMap, SynctexRead } from "./synctexFile.js";
