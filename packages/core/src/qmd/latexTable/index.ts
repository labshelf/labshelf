// Reads the table of a raw LaTeX block into the model the note previews and the linked-table charts plot, and reads and writes its width and alignment.
export { parseLatexTable, readLatexTableLayout, setLatexTableLayout } from "./latexTable.js";
export type { LatexCell, LatexInline, LatexRule, LatexTable } from "./latexTable.js";
