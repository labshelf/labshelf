/** Public API of the library UI protocol: the message unions and payloads, the channel ends, the in-page loopback and the guard for untrusted messages. */
export type { HostToUi, UiToHost } from "./messages.js";
export type {
  AddSource, IfNoPdf, LibraryUiSnapshot, PaperDetails, PaperStats, PdfMiss, SimilarPaper, TextLayerJobView,
} from "./payloads.js";
export type { HostEndpoint, LibraryTransport, MessageEnd } from "./transport.js";
export { createLoopbackTransport } from "./loopbackTransport.js";
export { isLibraryPath, parseUiMessage } from "./messageGuards.js";
