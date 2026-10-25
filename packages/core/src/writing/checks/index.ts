/** Exports the runtime-neutral pre-submission check: the rules over a PDF's facts and the project sources. */
export { runChecks } from "./runChecks.js";
export type { CheckInput } from "./runChecks.js";
export { derivePaperBody } from "./derivePaperBody.js";
export { derivePdfTextLines } from "./derivePdfTextLines.js";
export type { PdfTextItem } from "./derivePdfTextLines.js";
export { walkOperators } from "./operatorWalk.js";
export type { OperatorList, PageOperators } from "./operatorWalk.js";
export type { CheckProblem, CheckPosition, CheckRule, CheckSource, PdfFacts, PdfPageFacts, PlacedFigure } from "./checkReport.js";
export { deriveCountedPages, deriveReadingOrderTexts, countWordsUpTo } from "./limits/index.js";
export { readPdfFacts } from "./readPdfFacts.js";
