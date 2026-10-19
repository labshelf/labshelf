// Sends a source file's edits to LabShelf Helper as numbered `edit` messages, when a helper is connected.
import type { ChangeSet, Text } from "@codemirror/state";
import type { ILogger } from "@labshelf/core";
import type { TextChange } from "@labshelf/core/helper";
import type { EditorHelperPort } from "../helperProject";

const MODULE = "editor.helperEdits";

export interface HelperEdits {
  /** Sends the change from the previous text to `doc`. */
  changed(changes: ChangeSet, doc: Text): void;
  /** Tells the helper the file was written; the next edit carries the whole text again. */
  saved(): void;
}

/** CodeMirror reports each change against the text before the transaction, which is what the helper expects. */
function textChanges(changes: ChangeSet): TextChange[] {
  const result: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => { result.push({ from: fromA, to: toA, insert: inserted.toString() }); });
  return result;
}

/** The 1-based line, in the new text, of the first change; undefined when nothing changed. */
function firstChangedLine(changes: ChangeSet, doc: Text): number | undefined {
  let line: number | undefined;
  changes.iterChanges((_fromA, _toA, fromB) => { line ??= doc.lineAt(fromB).number; });
  return line;
}

/** What the editor needs from the helper. */
export type EditorHelper = EditorHelperPort;

export function createHelperEdits(helper: EditorHelper | undefined, projectId: string, path: string, logger: ILogger): HelperEdits {
  let version = 0;
  let wholeText = true;
  let loggedAbsent = false;
  const ready = (): boolean => {
    if (helper?.status()?.state === "ready") return true;
    if (!loggedAbsent) {
      loggedAbsent = true;
      void logger.log("INFO", MODULE, "No helper is connected; edits stay in the page", { projectId, path });
    }
    // The helper holds no text for this file now, so the first edit after it connects must carry all of it.
    wholeText = true;
    return false;
  };
  return {
    changed(changes, doc) {
      if (!ready()) return;
      version += 1;
      const edit = wholeText ? { text: doc.toString() } : { changes: textChanges(changes) };
      wholeText = false;
      helper!.edit(projectId, path, version, edit, firstChangedLine(changes, doc)).catch((error: unknown) => {
        // The helper's copy of the file may now differ, so the next edit carries the whole text again.
        wholeText = true;
        void logger.error(MODULE, error, { action: "send edit", projectId, path });
      });
    },
    saved() {
      if (!ready()) return;
      wholeText = true;
      helper!.save(projectId, path).catch((error: unknown) => {
        void logger.error(MODULE, error, { action: "send save", projectId, path });
      });
    },
  };
}
