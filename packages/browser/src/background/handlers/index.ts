// Exports the background message handlers' public API.
export {
  handleCaptureInspect, handleCaptureFindPdf, handleCaptureSave, handleCaptureTab, handleScholarSave, handleCaptureAttachPdf,
} from "./capture";
export {
  handleFindBetterPdf, handleFindPdfForPaper, handleRemovePaper, handleLibraryFolders, handleLibraryLookup, handleLibraryOpen, handleListTabs,
} from "./library";
export { accessTabDeps, handleOpenForPdf } from "./access";
export { handleAskAuthor, type AskAuthorDeps } from "./askAuthor";
export { handleCitationMapBuild, handleCitationMapImportDoi } from "./citationMap";
