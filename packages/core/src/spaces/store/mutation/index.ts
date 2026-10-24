// Exports the pure edits the Space store applies to a parsed Space or glossary.
export { renamedSpace, withProject, withPurpose, withoutProject } from "./spaceMutation.js";
export {
  withFocus, withFolder, withMovedReference, withPapers, withRenamedFolder, withoutFolder, withoutPaper,
} from "./folderMutation.js";
export type { Edited } from "./folderMutation.js";
export { withDate, withDone, withUpdatedDate, withoutDate } from "./dateMutation.js";
export type { SpaceDateDraft } from "./dateMutation.js";
export { withTerm, withUpdatedTerm, withoutTerm } from "./glossaryMutation.js";
export type { TermDraft } from "./glossaryMutation.js";
