// What other folders use of the drawing editor: the MathJax output parser shared with the math and drawing views, the
// canvas the figure editor's drawing mode drives, the ready-made shapes it inserts, and the pure changes its selection bar
// and inspector apply (transform, grouping, order, alignment, flips, a new function on axes).
export { parseMathSvg, svgDimension, type MathLoader } from "./mathSvg.js";
export { drawingSvg, parseSvg, renderDrawingParts } from "./drawingRender.js";
export * from "./drawingPng.js";
export * from "./drawingSanitize.js";
export { brokenSummary, mountDrawingCanvas, type DrawingCanvas } from "./drawingCanvas.js";
export { setTransform } from "./transform.js";
export { alignSelection, flipSelection, groupSelection, reorderSelection, ungroupSelection, type AlignEdge } from "./arrange.js";
export { SHAPE_SECTIONS, SHAPES, templateModel, type ShapeTemplate } from "./shapeLibrary.js";
export { addFunction } from "./gestures.js";
export type { Tool } from "./state.js";
