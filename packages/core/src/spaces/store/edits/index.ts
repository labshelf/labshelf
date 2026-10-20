// Exports the pure edits the Space store applies to a parsed Space or glossary.
export { renamedSpace, withProject, withPurpose, withoutProject } from "./spaceEdits.js";
export {
  withFocus, withFolder, withMovedReference, withPapers, withRenamedFolder, withoutFolder, withoutPaper,
} from "./folderEdits.js";
export type { Edited } from "./folderEdits.js";
export { withDate, withDone, withUpdatedDate, withoutDate } from "./dateEdits.js";
export type { SpaceDateDraft } from "./dateEdits.js";
export { withTerm, withUpdatedTerm, withoutTerm } from "./glossaryEdits.js";
export type { TermDraft } from "./glossaryEdits.js";
