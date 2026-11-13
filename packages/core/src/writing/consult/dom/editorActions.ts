// The consult actions of a mounted source editor: its scoped citing, its Insert code listing and its Link output, behind the ConsultActions port.
import { excerptFromLines } from "../../codeLinks/index.js";
import type { SourceEditor } from "../../dom/sourceEditor/editor.js";
import type { ConsultRef } from "../consultRequests.js";
import type { ConsultActions } from "./consultActions.js";

/**
 * `codePath` gives a consulted code file's path relative to the editor's project folder, as a listing records it ('../' allowed), or undefined when
 * the file cannot be linked from there; a host that knows no such path leaves listing out. Undefined when the editor can neither cite nor list.
 */
export function createEditorConsultActions(editor: Pick<SourceEditor, "scopedCiting" | "insertCodeExcerpt" | "outputLinks">, codePath?: (ref: ConsultRef) => string | undefined): ConsultActions | undefined {
  const { scopedCiting, insertCodeExcerpt, outputLinks } = editor;
  if (!scopedCiting) return undefined;
  const actions: ConsultActions = {
    cite: (paperId, scope, quoted) => scopedCiting.cite(paperId, scope, quoted),
    citationText: (paperId, scope, quoted) => scopedCiting.text(paperId, scope, quoted),
  };
  if (insertCodeExcerpt && codePath) {
    actions.canList = (ref) => codePath(ref) !== undefined;
    actions.insertListing = async (ref, text, startLine, endLine) => {
      const path = codePath(ref);
      if (path === undefined) throw new Error("This file cannot be linked from this project.");
      await insertCodeExcerpt(excerptFromLines(path, text, startLine, endLine));
    };
  }
  if (outputLinks) actions.linkOutput = () => { void outputLinks.insert(); };
  return actions;
}
