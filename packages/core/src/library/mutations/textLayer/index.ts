/** Exports the text-layer verdicts' public API: the outcome types and the rules that turn them into a stored verdict. */
export { shouldRecordVerdict, verdictForDetection, verdictForError, verdictForOutcome, wallClock } from "./textLayerVerdict.js";
export type { ExistingLayer, TextLayerDetection, TextLayerOutcome, TextLayerSkipCode } from "./textLayerTypes.js";
export type { PdfTextLayerBuilder, TextLayerHooks, TextLayerProgress } from "./textLayerBuilder.js";
