/** Exports the DOM part of the consult port (`@labshelf/core/consult`): the controller hosts mount, its windows' views, the chooser, the footer, the client and the editable file. */
export { askConsult } from "./consultClient.js";
export type { ConsultClient } from "./consultClient.js";
export { openConsultChooser } from "./consultChooser.js";
export type { ConsultChooserOptions } from "./consultChooser.js";
export { consultKindIcon, createConsultFooter, renderConsultChips } from "./consultFooter.js";
export type { ConsultFooterOptions } from "./consultFooter.js";
export { createConsult } from "./createConsult.js";
export type { Consult, ConsultOptions, ConsultSetup } from "./createConsult.js";
export { mountEditableView } from "./editableView.js";
export type { EditableView } from "./editableView.js";
export { editableFromReplica } from "./editableFile.js";
export type { EditableFile, EditableFileOpener } from "./editableFile.js";
export { mountPaperView } from "./paperView.js";
export type { PaperView } from "./paperView.js";
export { createActionBubble, isQuotable } from "./consultActions.js";
export type { ActionBubble, ConsultActions } from "./consultActions.js";
export type { ManuscriptWindow } from "./createConsult.js";
export { createEditorConsultActions } from "./editorActions.js";
