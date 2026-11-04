// What other folders use of the drawing editor: the MathJax output parser shared with the math and drawing views, the
// canvas the figure editor's drawing mode drives, and setTransform, which the inspector's Transform fields use.
export { parseMathSvg, svgDimension } from "./mathSvg.js";
export { brokenSummary, mountDrawingCanvas, type Broken, type DrawingCanvas } from "./drawingCanvas.js";
export type { Tool } from "./state.js";
export { setTransform } from "./transform.js";
