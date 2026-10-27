// Exports the LaTeX editing features: command and environment completion, \begin auto-close, label completion and diagnostics, outline, word count and math hover.
export { registerLatexCommandCompletion, registerLatexEditing, createMathHoverProvider } from "./editing.js";
export { LatexProjectSources, createProjectSourceReader } from "./project.js";
