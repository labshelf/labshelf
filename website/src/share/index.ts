// Exports what the share page entry needs: the read-only folder, its in-page host, reader, downloads and page chrome.
export { createShareLibrary, type ShareLibrary } from "./shareLibrary.js";
export { pdfFileName, zipEntryNames, zipFileName } from "./downloadNames.js";
export { attachShareHost, READ_ONLY_NOTICE, type ShareHostPorts } from "./shareHost.js";
export { downloadPdf, downloadZip, loadPdfBytes, PdfLoadError, saveFile } from "./shareDownloads.js";
export { mountShareReader } from "./shareReaderView.js";
export { installShareStyles, type ShareView } from "./shareStyles.js";
export { LOADING_STATE, openErrorState, PDF_ERROR_TEXT, renderState, type PageState } from "./shareStates.js";
export { renderTopBar, type TopBarOptions } from "./shareTopBar.js";
