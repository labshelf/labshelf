// Exports the Space file model: types, space.json and glossary.json parse/serialize, and id rules.
export { SPACE_DATE_KINDS, SPACE_FORMAT_VERSION } from "./space.js";
export type {
  Glossary, GlossaryReadResult, GlossarySource, GlossaryTerm, Space, SpaceDate, SpaceDateKind,
  SpaceFolder, SpaceInvalidEntries, SpaceReference, SpaceProjectDate, SpaceReadDate, SpaceReadResult, SpaceTaskDate, UnknownFields,
} from "./space.js";
export { createEntryId, deriveSpaceId, parseGlossaryFile, serializeGlossaryFile, serializeSpaceFile } from "./space.js";
export { isPage, parseEntryIds, parseSpaceFile } from "./parseSpaceFile.js";
