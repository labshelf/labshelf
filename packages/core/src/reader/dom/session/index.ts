/** Public surface of the reader session group. */
export type { PdfLocation, ReaderContext } from "./context.js";
export { installTextLayerFocusGuard } from "./focusGuard.js";
export { HostBridge, type ReaderTransport } from "./hostBridge.js";
export { describeLoadError, loadPdf, type PdfSourceHooks } from "./pdfLoader.js";
export { PerfMarks } from "./perfMarks.js";
export { createViewer } from "./viewerSetup.js";
