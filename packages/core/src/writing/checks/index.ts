/** Exports the pre-submission check (the rules over a PDF's facts and the project sources) and a project's Checklist: its model, reads, edits and sidebar rows. */
export { runChecks } from "./runChecks.js";
export type { CheckInput, CheckProblem, CheckPosition, CheckRule, CheckSource } from "./runChecks.js";
export { derivePaperBody, derivePdfTextLines, walkOperators, readPdfFacts, deriveCountedPages, deriveReadingOrderTexts, countWordsUpTo } from "./pdfFacts.js";
export type { OperatorList, PageOperators, PdfFacts, PdfPageFacts, PdfTextItem, PlacedFigure } from "./pdfFacts.js";
export * from "./checklist.js";
export { scanTodos, type TodoItem } from "./todoMarkers.js";
export { scanNoteTasks, toggleNoteTask, type NoteTask } from "./noteTasks.js";
export { readManualItems, readChecklistSignals, updateChecklist } from "./checklistSignals.js";
export type { ChecklistSignals, ProjectNotesSource } from "./checklistSignals.js";
export { deriveChecklistSidebarNodes } from "./checklistSidebar.js";
export type { ChecklistTree, ChecklistTreeInput, ReadingPaper } from "./checklistSidebar.js";
