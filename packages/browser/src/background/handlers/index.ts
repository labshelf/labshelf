// Exports the background message handlers' public API.
export {
  handleCaptureInspect, handleCaptureFindPdf, handleCaptureSave, handleCaptureTab, handleSearchHitSave, handleCaptureAttachPdf,
} from "./capture";
export {
  handleFindBetterPdf, handleFindPdfForPaper, handleRemovePaper, handleLibraryFolders, handleLibraryLookup, handleLibraryOpen, handleListTabs,
} from "./library";
export { accessTabDeps, handleOpenForPdf } from "./access";
