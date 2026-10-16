/** Exports the Node side of a project's Checklist: reading and editing .labshelf/checklist.json and reading a project's open-item signals. */
export { readManualItems, updateChecklist } from "./checklistStore.js";
export { readChecklistSignals } from "./readChecklistSignals.js";
export type { ChecklistSignals } from "./readChecklistSignals.js";
