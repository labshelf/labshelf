/** Pure page-text logic: line grouping, in-text reference detection, captions, float regions and the reference list. */
export * from "./textLines.js";
export * from "./inTextRefs.js";
export { findCaptionLines, pickCaption, type CaptionHit } from "./captions.js";
export * from "./floatRegion.js";
export * from "./referenceList.js";
export * from "./referenceSplit.js";
