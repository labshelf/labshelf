/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A source editor bound to a shared file takes its text from the Y.Text, never writes the file itself, undoes only through the Y.UndoManager
// and hands the helper every change, a peer's included.
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { ILogger, PresenceStore } from "@labshelf/core";
import type { HelperChange } from "@labshelf/core/helper";
import * as Y from "yjs";
import { mountSourceEditor, type SourceFileAccess } from "../../../src/writing/editor/mountSourceEditor";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const presence = {
  awareness: { clientID: 7, on: () => undefined, off: () => undefined },
  setLocal: () => undefined,
  remote: () => new Map(),
} as unknown as PresenceStore;

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

  it("hands the helper a peer's edit of the shared text, so a build never compiles stale text", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "abc");
    const edits: HelperChange[] = [];
    const helper = {
      status: () => ({ state: "ready" as const, helperVersion: "1", tex: { source: "none" as const, complete: false }, host: "helper" as const }),
      edit: jest.fn(async (_id: string, _path: string, _version: number, edit: HelperChange) => { edits.push(edit); }),
      save: jest.fn(async () => undefined),
    };
    const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => "abc", write: async () => undefined };
    const editor = await mountSourceEditor(document.createElement("div"), {
      projectId: "p", path: "main.tex", files, papers: async () => [], helper, logger, onDirty: () => undefined, collab: { text, presence, name: "Ada" },
    });
    expect(edits).toEqual([{ text: "abc" }]);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getText("content").insert(3, "def");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)), "relay");
    expect(edits[1]).toEqual({ changes: [{ from: 3, to: 3, insert: "def" }] });
    await editor.dispose();
  });
});
