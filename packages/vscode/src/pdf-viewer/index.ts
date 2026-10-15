/** Exports the VS Code PDF reader: its webview panels and its export ports. */
export { PdfViewerPanel } from "./PdfViewerPanel.js";
export { ReaderPanel, type ReaderPanelDeps } from "./ReaderPanel.js";
export { createVsCodeExportPorts } from "./readerHostPorts.js";
export type { PdfjsLocator } from "./renderer/index.js";
