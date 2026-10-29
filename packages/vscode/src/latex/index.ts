// Exports the LaTeX editing features: command and environment completion, \begin auto-close, label completion and diagnostics, outline, word count and math hover.
export { createThemedMathMarkdown, registerLatexCommandCompletion, registerLatexEditing } from "./editing.js";
export { LatexProjectSources, createProjectSourceReader, deriveVscodeRange } from "./project.js";
