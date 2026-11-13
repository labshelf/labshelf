/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A source editor bound to a local replica: collab extensions without presence, a persist() called after the save delay and on flush,
// and a reload that leaves the replica's text alone. The share's collab mode (presence and name, no persist) keeps writing nothing.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger, PresenceStore } from "@labshelf/core";
import * as Y from "yjs";
import { createCollabExtensions } from "../../../src/collab/dom/editorCollab";
import { mountSourceEditor, type SourceEditor, type SourceFileAccess } from "../../../src/writing/dom/sourceEditor/editor";
import { reloadOpenEditor } from "../../../src/writing/dom/sourceEditor/openEditors";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const SAVE_DELAY_MS = 300;

afterEach(() => { jest.useRealTimers(); });

describe("createCollabExtensions without presence", () => {
  function mountView(initial: string) {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, initial);
    const host = document.createElement("div");
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: text.toString(), extensions: [createCollabExtensions({ text, file: "main.tex" })] }),
    });
    return { view, text, doc };
  }

  it("3.1b mounts in an EditorView showing the Y.Text", () => {
    const { view } = mountView("shared\ntext");
    expect(view.state.doc.toString()).toBe("shared\ntext");
    view.destroy();
  });

  it("3.1b typing changes the Y.Text", () => {
    const { view, text } = mountView("abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(text.toString()).toBe("xabc");
    view.destroy();
  });

  it("3.1b a Y.Text change from another origin shows in the view", () => {
    const { view, text, doc } = mountView("abc");
    doc.transact(() => { text.insert(3, "def"); }, "disk");
    expect(view.state.doc.toString()).toBe("abcdef");
    doc.transact(() => { text.delete(0, 1); }, "peer");
    expect(view.state.doc.toString()).toBe("bcdef");
    view.destroy();
  });

  it("3.1b keeps selection moves working without publishing anywhere", () => {
    const { view } = mountView("abc");
    expect(() => view.dispatch({ selection: { anchor: 2 } })).not.toThrow();
    expect(view.state.selection.main.head).toBe(2);
    view.destroy();
  });
});

async function mountLocal(path: string, initial: string, persist: () => Promise<void> = async () => undefined) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, initial);
  const write = jest.fn(async () => undefined);
  const read = jest.fn(async () => "disk text");
  const files: SourceFileAccess = { list: async () => [path], read, write };
  const host = document.createElement("div");
  const dirty = jest.fn();
  const saved = jest.fn();
  const persistMock = jest.fn(persist);
  const editor: SourceEditor = await mountSourceEditor(host, {
    projectId: "local-sync-3-1", path, files, papers: async () => [], helper: undefined, logger, onDirty: dirty, onSaved: saved,
    collab: { text, persist: persistMock },
  });
  return { editor, view: EditorView.findFromDOM(host)!, doc, text, write, read, dirty, saved, persist: persistMock };
}

describe("mountSourceEditor with a local replica", () => {
  it("3.1c starts from the Y.Text and never reads the disk", async () => {
    const { editor, view, read } = await mountLocal("c0.tex", "replica text");
    expect(view.state.doc.toString()).toBe("replica text");
    expect(read).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("3.1c one edit calls persist once after the save delay and fires onSaved", async () => {
    jest.useFakeTimers();
    const { editor, view, text, persist, saved, dirty, write } = await mountLocal("c1.tex", "abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(text.toString()).toBe("xabc");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(persist).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(dirty).toHaveBeenLastCalledWith(false);
    await jest.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("3.1c several quick edits are persisted once, after the last one", async () => {
    jest.useFakeTimers();
    const { editor, view, persist, saved } = await mountLocal("c2.tex", "abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    await jest.advanceTimersByTimeAsync(200);
    view.dispatch({ changes: { from: 0, insert: "y" } });
    await jest.advanceTimersByTimeAsync(200);
    expect(persist).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    await editor.dispose();
  });

  it("3.1c flush with a pending edit calls persist at once and resolves true", async () => {
    jest.useFakeTimers();
    const { editor, view, persist, saved, write } = await mountLocal("c3.tex", "abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(persist).not.toHaveBeenCalled();
    await expect(editor.flush()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("3.1c flush with nothing pending resolves true without calling persist", async () => {
    const { editor, persist, write } = await mountLocal("c4.tex", "abc");
    await expect(editor.flush()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("3.1c a persist that rejects makes flush resolve false and keeps the edit pending for the next flush", async () => {
    let fail = true;
    const { editor, view, persist, saved } = await mountLocal("c5.tex", "abc", async () => { if (fail) throw new Error("disk full"); });
    view.dispatch({ changes: { from: 0, insert: "x" } });
    await expect(editor.flush()).resolves.toBe(false);
    expect(saved).not.toHaveBeenCalled();
    fail = false;
    await expect(editor.flush()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
    await editor.dispose();
  });

  it("3.1c dispose settles a pending edit through persist, never through files.write", async () => {
    const { editor, view, persist, write } = await mountLocal("c6.tex", "abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    await editor.dispose();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("3.1d reloadOpenEditor resolves true and neither reads the disk nor changes the text", async () => {
    const { editor, view, text, read } = await mountLocal("d1.tex", "replica text");
    await expect(reloadOpenEditor("local-sync-3-1", "d1.tex")).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(text.toString()).toBe("replica text");
    expect(view.state.doc.toString()).toBe("replica text");
    await editor.dispose();
  });

  it("3.1d reload keeps an unsaved edit in the text and in the view", async () => {
    const { editor, view, text, read } = await mountLocal("d2.tex", "abc");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    await expect(reloadOpenEditor("local-sync-3-1", "d2.tex")).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(text.toString()).toBe("xabc");
    expect(view.state.doc.toString()).toBe("xabc");
    await editor.dispose();
  });

  it("3.1d a change that reached the Y.Text from another origin stays after a reload", async () => {
    const { editor, view, text, doc, read } = await mountLocal("d3.tex", "abc");
    doc.transact(() => { text.insert(3, "def"); }, "disk");
    await expect(reloadOpenEditor("local-sync-3-1", "d3.tex")).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(text.toString()).toBe("abcdef");
    expect(view.state.doc.toString()).toBe("abcdef");
    await editor.dispose();
  });
});

describe("mountSourceEditor with a share's collab", () => {
  const presence = {
    awareness: { clientID: 7, on: () => undefined, off: () => undefined },
    setLocal: () => undefined,
    remote: () => new Map(),
  } as unknown as PresenceStore;

  it("3.1d keeps its behaviour: the shared text is shown, edits go to the Y.Text, nothing is written or saved by the editor", async () => {
    jest.useFakeTimers();
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "shared");
    const write = jest.fn(async () => undefined);
    const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => "disk text", write };
    const host = document.createElement("div");
    const saved = jest.fn();
    const editor = await mountSourceEditor(host, {
      projectId: "local-sync-3-1-share", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: jest.fn(), onSaved: saved,
      collab: { text, presence, name: "Ada" },
    });
    const view = EditorView.findFromDOM(host)!;
    expect(view.state.doc.toString()).toBe("shared");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(text.toString()).toBe("xshared");
    await jest.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3);
    await expect(editor.flush()).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    await editor.dispose();
  });
});
