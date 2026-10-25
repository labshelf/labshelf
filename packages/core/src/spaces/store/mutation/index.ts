// Exports the pure edits the Space store applies to a parsed Space or glossary.
export { withSpaceRenamed, withProject, withPurpose, withProjectRemoved } from "./spaceMutation.js";
export {
  withFocus, withFolder, withMovedReference, withPapers, withRenamedFolder, withFolderRemoved, withPaperRemoved,
} from "./folderMutation.js";
export type { Edited } from "./folderMutation.js";
export { withDate, withDone, withUpdatedDate, withDateRemoved } from "./dateMutation.js";
export type { SpaceDateInput } from "./dateMutation.js";
export { withTerm, withUpdatedTerm, withTermRemoved } from "./glossaryMutation.js";
export type { TermInput } from "./glossaryMutation.js";
