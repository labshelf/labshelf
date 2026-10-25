/** Exports the runtime-neutral pre-submission check: the rules over a PDF's facts and the project sources. */
export { runChecks } from "./runChecks.js";
export type { CheckInput } from "./runChecks.js";
export { paperBody } from "./paperBody.js";
export { pdfTextLines } from "./pdfTextLines.js";
export type { PdfTextItem } from "./pdfTextLines.js";
export { walkOperators } from "./operatorWalk.js";
export type { OperatorList, PageOperators } from "./operatorWalk.js";
export type { CheckFinding, CheckLocation, CheckRule, CheckSource, PdfFacts, PdfPageFacts, PlacedImage } from "./checkReport.js";
export { countedPages, readingOrderTexts, wordsUpTo } from "./limits/index.js";
export { readPdfFacts } from "./readPdfFacts.js";
