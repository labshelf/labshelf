/** Exports the VS Code PDF reader: its webview panels and its export ports. */
export { PdfReaderPanel } from "./readerPaperOpener.js";
export { ReaderPanel, type ReaderPanelDeps } from "./ReaderPanel.js";
export { createVsCodeExportPorts } from "./readerHostPorts.js";
export type { PdfjsLocator } from "./readerShell.js";
