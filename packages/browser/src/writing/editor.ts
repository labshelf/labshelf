// Mounts core's CodeMirror source editor with the browser's comment support (its source footer and body editor); the rest re-exports core's editor.
import { mountSourceEditor as mountCoreSourceEditor, type SourceEditor, type SourceEditorDeps } from "@labshelf/core/sourceEditor";
import { createCommentSupport } from "../collab";

export {
  applyProblems, codeHighlight, createEditorExtensions, createHelperUpdates, createWriteScheduler, editorTheme, showLine, toProblems,
  type EditorExtensionOptions, type EditorHelper, type ProblemSource, type SourceEditor, type SourceEditorDeps, type SourceFileAccess, type WriteSchedulerDeps,
} from "@labshelf/core/sourceEditor";

export function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  return mountCoreSourceEditor(host, { commentSupport: createCommentSupport, ...deps });
}
