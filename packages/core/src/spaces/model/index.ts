// Exports the Space file model: types, space.json and glossary.json parse/serialize, and id rules.
export { SPACE_DATE_KINDS, SPACE_FORMAT_VERSION } from "./space.js";
export type {
  Glossary, GlossaryReadResult, GlossarySource, GlossaryTerm, Space, SpaceDate, SpaceDateKind, SpaceDeadlineDate,
  SpaceFolder, SpaceInvalidEntries, SpaceReference, SpaceProjectDate, SpaceReadDate, SpaceReadResult, SpaceTaskDate, UnknownFields,
} from "./space.js";
export { parseSpaceFile } from "./parseSpaceFile.js";
export { serializeSpaceFile } from "./serializeSpaceFile.js";
export { parseGlossaryFile, serializeGlossaryFile } from "./glossaryFile.js";
export { newShortId, spaceIdFromName } from "./spaceId.js";
