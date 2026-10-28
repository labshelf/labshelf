// Exports the writing features other folders use: open source editors and project sessions, the project list, project content and library ports, history, source actions and notices, and the search host.
export type { SourceEditor, SourceEditorDeps, SourceFileAccess } from "./editor";
export { addProjectUpdateEvent, mountHistoryHost } from "./history";
export { askProjectTitle, createBrowserProjectContent, createPageProjectLibrary, findProject } from "./project";
export { createProjectsSource, showPdfInTab, type BrowserProjectRow, type ProjectsSource } from "./projectList";
export { mountSearchHost } from "./searchHost";
export { createOpenProjectSnapshot, createProjectSession, openRestoredProject, showInOpenEditor, type ProjectSession } from "./session";
export { createSourceActions, deriveSourceLanguage, mountOnTakeover, openSharedProjectHere, readSourceFileMode, renderObservingNotice, renderUnresolvedNotice, type SourceFileMode } from "./source";
