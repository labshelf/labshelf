/** Exports the library UI flows' public API: paper commands, copying, and the dialogs and pickers that precede host work. */
export {
  askAuthor, attachPdf, changeTags, findPdf, fixableIds, hostFileAction, makeSearchable, openPaper, openSource,
  saveNote, setPaperStatus, splitTags, promptAddTags,
} from "./paper/index.js";
export { CITE_LABEL, copyCitation, copyText } from "./citeCopy.js";
export { confirmRemove } from "./confirmRemove.js";
export { pickMoveTarget } from "./pickMoveTarget.js";
export { revealPaper } from "./revealPaper.js";
export { confirmDeleteFolder, promptNewFolder, promptRenameFolder } from "./folderPrompts.js";
export { askNoPdf, confirmFindBetterPdf, onFindMiss, onPdfMissing, onAddNoPdf, onAddSources, requestAddPaper, type NoPdfChoice } from "./pdf/index.js";
