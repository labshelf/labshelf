// Exports the LaTeX editing features: command and environment completion, \begin auto-close, label completion and diagnostics, outline, word count and math hover.
export { registerLatexCommandCompletion } from "./commands/index.js";
export { registerLatexEditing } from "./registerLatexEditing.js";
export { LatexProjectSources } from "./project/index.js";
export { mathHoverProvider } from "./mathHover.js";
export { registerWordCount } from "./registerWordCount.js";
