/** Exports the library UI protocol's public API: message unions and payloads, channel ends, in-page loopback, guard for untrusted messages. */
export type { HostToUi, UiToHost } from "./messages.js";
export type {
  AddSource, CitationMapState, CitationMapView, MissingPdfAction, LibraryUiSnapshot, PaperDetails, PaperFile, PaperFilesState, PaperStats, PdfAccess, PdfMiss, SimilarPaper, TextLayerJobView,
} from "./payloads.js";
export type { HostEndpoint, LibraryTransport, MessageEnd } from "./transport.js";
export { createLoopbackTransport } from "./loopbackTransport.js";
export { parseUiMessage } from "./messageGuards.js";
