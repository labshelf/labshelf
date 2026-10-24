/** Exports the pure page-text logic: line grouping, in-text reference detection, captions, float regions and the reference list. */
export * from "./textLines.js";
export * from "./inTextReferences.js";
export { findCaptionLines, pickCaption } from "./captions.js";
export * from "./figureRegion.js";
export * from "./referenceList.js";
export * from "./referenceSplit.js";
