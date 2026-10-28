// Exports what the share page entry needs: the read-only folder, its in-page host, reader, downloads and page chrome.
export { createShareLibrary, type ShareLibrary } from "./shareLibrary.js";
export { attachShareHost } from "./shareHost.js";
export { downloadPdf, downloadZip, PdfLoadError, saveFile } from "./shareDownloads.js";
export { mountShareReader } from "./shareReaderView.js";
export { installShareStyles } from "./shareStyles.js";
export { LOADING_STATE, openErrorState, PDF_ERROR_TEXT, renderState } from "./shareStates.js";
export { renderTopBar } from "./shareTopBar.js";
