// What other folders use of the drawing editor: the MathJax output parser shared with the math and drawing views,
// and a loader for the editor chunk, so that viewing a note never pulls the editor in.
export { parseMathSvg, svgDimension } from "./mathSvg.js";

/** Loads the drawing editor chunk (`@labshelf/core/drawingEditor`) the first time a drawing is opened. */
export const loadDrawingEditor = () => import("./openDrawingEditor.js");
