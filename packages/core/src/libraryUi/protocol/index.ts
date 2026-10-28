/** Exports the library UI protocol's public API: message unions and payloads, the Details surface's envelope, channel ends, in-page loopback, guards for untrusted messages. */
export type { HostToUi, UiToHost, DetailsSelection, DetailsToHost, HostToDetails } from "./messages.js";
export type {
  AddSource, CitationMapState, CitationMapView, MissingPdfAction, LibraryUiSnapshot, PaperDetails, PaperFile, PaperFilesState, PaperNoteView, PaperStats, PdfAccess, PdfMiss, SimilarPaper, TextLayerJobView,
} from "./messages.js";
export type { HostEndpoint, LibraryTransport, MessageEnd } from "./transport.js";
export { createLoopbackTransport } from "./transport.js";
export { parseUiMessage, parseDetailsMessage } from "./messages.js";
