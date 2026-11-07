// Exports the ProseMirror model of LabShelf Markdown item bodies.
export { qmdSchema } from "./qmdSchema.js";
export { bodyToDoc, docToBody } from "./qmdDoc.js";
export { isWritableResultTex } from "./mathResult.js";
export { readAttrWidth, setAttrWidth, readAttrAlign, setAttrAlign, cssWidth, figureAttributes, setFigureWidth, setFigureAlign, carryFigureAttributes, type MediaAlign } from "./mediaWidth.js";
export { numberEquations, findEquation, type NumberedEquation } from "./equationNumbers.js";
