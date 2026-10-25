// Exports the LaTeX editing features: command and environment completion, \begin auto-close, label completion and diagnostics, outline, word count and math hover.
export { registerLatexCommandCompletion } from "./registerLatexCommandCompletion.js";
export { registerLatexEditing } from "./registerLatexEditing.js";
export { LatexProjectSources } from "./project/index.js";
export { createMathHoverProvider } from "./mathHover.js";
export { registerWordCount } from "./registerWordCount.js";
