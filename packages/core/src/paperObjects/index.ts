/** Exports the paper-object domain: listing a paper's equations, figures and tables from its PDF text and building what a note inserts for one. */
export type { PageBox, PaperChoice, PaperObject, PaperObjectInsert, PaperObjectInsertOptions, PaperObjectKind, PaperObjectVia, PaperObjectsPort } from "./types.js";
export { analysePdfPage, boxToRegion, deriveRegionLines, listPaperObjects, readPdfPages, regionToBox, type PdfPageText, type PdfTextSource } from "./list.js";
export { formatPipeTable, parsePipeTable, tableFromTextItems } from "./tables.js";
export { tableFromTabular } from "./tabular.js";
export {
  buildPaperObjectMarkdown, createPaperObjectService, derivePaperEquationLabel,
  type PaperObjectContent, type PaperObjectMarkdownInput, type PaperObjectServiceDeps, type RegionRenderer,
} from "./service.js";
export {
  answerPaperObjectsRequest, createPaperObjectsClient, isPaperObject, isPaperObjectsReply, isPaperObjectsRequest, unsupportedPaperObjectsReply,
  type PaperObjectInsertWire, type PaperObjectsCall, type PaperObjectsReply, type PaperObjectsRequest, type PaperObjectsValue,
} from "./protocol.js";
export { createLibraryPaperObjects, rankPaperChoices, type LibraryPaperObjectsDeps, type OpenPaperPdf } from "./library.js";
