/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A source editor bound to a shared file takes its text from the Y.Text, never writes the file itself and undoes only through the Y.UndoManager.
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { ILogger, PresenceHandle } from "@labshelf/core";
import * as Y from "yjs";
import { mountSourceEditor, type SourceFileAccess } from "../../../src/library-page/editor/mountSourceEditor";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const presence = {
  awareness: { clientID: 7, on: () => undefined, off: () => undefined },
  setLocal: () => undefined,
  remote: () => new Map(),
} as unknown as PresenceHandle;

async function mountShared(initial: string) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, initial);
  const write = jest.fn(async () => undefined);
  const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => "disk text", write };
  const host = document.createElement("div");
  const dirty = jest.fn();
  const editor = await mountSourceEditor(host, {
    projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: dirty,
    collab: { text, presence, name: "Ada" },
  });
  return { editor, view: EditorView.findFromDOM(host)!, text, write, dirty };
}

describe("source editor bound to a shared file", () => {
  it("shows the shared text, mirrors edits into it and never writes the file", async () => {
    const { editor, view, text, write, dirty } = await mountShared("shared\ntext");
    expect(view.state.doc.toString()).toBe("shared\ntext");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(text.toString()).toBe("xshared\ntext");
    expect(await editor.flush()).toBe(true);
    await editor.dispose();
    expect(write).not.toHaveBeenCalled();
    expect(dirty).not.toHaveBeenCalled();
  });

  it("leaves undo to the shared undo manager: the CodeMirror history is off", async () => {
    const { editor, view } = await mountShared("abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("xabc");
    await editor.dispose();
  });
});
