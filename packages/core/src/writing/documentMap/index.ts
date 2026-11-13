// Exports the document map of a build preview's rail: headings with includes expanded, review and content marks, and their source order.
export {
  buildDocumentMap, deriveDocumentMapOrder, findDocumentMapLine, DOCUMENT_MAP_MARK_KINDS, foldHeadingTitle, interpolateDocumentMap, invertDocumentMap, matchDocumentMapOutline,
} from "./documentMap.js";
export type { DocumentMap, DocumentMapHeading, DocumentMapInput, DocumentMapMark, DocumentMapMarkKind, DocumentMapPlace, DocumentMapSegment } from "./documentMap.js";
