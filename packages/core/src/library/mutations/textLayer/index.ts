/** Exports the text-layer verdicts' public API: the outcome types and the rules that turn them into a stored verdict. */
export { shouldWriteVerdict, deriveVerdictForDetection, deriveVerdictForError, deriveVerdictForOutcome, readWallClock } from "./textLayerVerdict.js";
export type { ExistingLayer, TextLayerDetection, TextLayerOutcome, TextLayerSkipKind } from "./textLayerOutcome.js";
export type { PdfTextLayerBuilder, TextLayerHooks, TextLayerProgress } from "./textLayerBuilder.js";
