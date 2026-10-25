/** Exports the library UI flows' public API: paper commands, copying, and the dialogs and pickers that precede host work. */
export {
  askAuthor, attachPdf, changeTags, findPdf, fixableIds, hostFileAction, makeSearchable, openPaper, openSource,
  saveNote, setPaperStatus, splitTags, promptAddTags,
} from "./paper/index.js";
export { CITE_LABEL, copyCitation, copyText } from "./citationCopy.js";
export { confirmRemove } from "./askRemove.js";
export { pickMoveTarget } from "./pickMoveFolder.js";
export { revealPaper } from "./showPaper.js";
export { confirmDeleteFolder, promptNewFolder, promptRenameFolder } from "./askFolder.js";
export { askNoPdf, confirmFindBetterPdf, onFindMiss, onPdfMissing, onAddNoPdf, onAddSources, requestAddPaper, type NoPdfChoice } from "./pdf/index.js";
