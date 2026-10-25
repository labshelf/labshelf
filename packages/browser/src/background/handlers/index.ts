// Exports the background message handlers' public API.
export {
  answerCaptureInspect, answerCaptureFindPdf, answerCaptureWrite, answerCaptureTab, answerSearchHitWrite, answerCaptureAttachPdf,
} from "./capture";
export {
  answerFindBetterPdf, answerFindPdfForPaper, answerRemovePaper, answerLibraryFolders, answerLibraryFind, answerLibraryOpen, answerListTabs,
} from "./library";
export { createAccessTabDeps, answerOpenForPdf } from "./access";
