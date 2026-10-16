/** Exports the library UI protocol's public API: message unions and payloads, channel ends, in-page loopback, guard for untrusted messages, the citation map's view shape. */
export type { HostToUi, UiToHost } from "./messages.js";
export type {
  AddSource, CitationMapState, CitationMapView, IfNoPdf, LibraryUiSnapshot, PaperDetails, PaperStats, PdfAccess, PdfMiss, SimilarPaper, TextLayerJobView,
} from "./payloads.js";
export type { HostEndpoint, LibraryTransport, MessageEnd } from "./transport.js";
export { createLoopbackTransport } from "./loopbackTransport.js";
export { isLibraryPath, parseUiMessage } from "./messageGuards.js";
export { citationMapView } from "./citationMapView.js";
