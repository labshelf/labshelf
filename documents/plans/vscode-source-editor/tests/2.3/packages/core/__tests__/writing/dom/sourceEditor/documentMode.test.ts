/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Document mode (D3): the editor starts from the host's text, pushes its changes as collab updates, applies host updates outside its undo history,
// mirrors the host's dirty flag and asks the host to save on Mod-s. It never reads the file for its own text and never writes it.
import { isolateHistory, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { ILogger } from "../../../../src/ports";
import type { SourceUpdate } from "../../../../src/writing/sourceEditor/authority";
import type { SourceDocument } from "../../../../src/writing/dom/sourceEditor/documentMode";
import { mountSourceEditor, type SourceEditorDeps, type SourceFileAccess } from "../../../../src/writing/dom/sourceEditor/editor";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

type Listener = Parameters<SourceDocument["subscribe"]>[0];

function fakeDocument(over: Partial<Pick<SourceDocument, "text" | "lineBreak" | "version" | "dirty">> = {}) {
  let listener: Listener | undefined;
  const push = jest.fn<void, [number, SourceUpdate[]]>();
  const save = jest.fn<void, []>();
  const document: SourceDocument = {
    text: "hello", lineBreak: "\n", version: 3, dirty: false, ...over,
    push,
    save,
    subscribe(next) {
      listener = next;
      return () => { if (listener === next) listener = undefined; };
    },
  };
  return {
    document,
    push,
    save,
    host: {
      updates: (version: number, updates: SourceUpdate[]) => listener!.updates(version, updates),
      resync: (text: string, version: number) => listener!.resync(text, version),
      dirty: (dirty: boolean) => listener!.dirty(dirty),
    },
  };
}

async function mount(over: Partial<Pick<SourceDocument, "text" | "lineBreak" | "version" | "dirty">> = {}, extra: Partial<SourceEditorDeps> = {}) {
  const write = jest.fn(async () => undefined);
  const read = jest.fn(async () => "DISK TEXT");
  const files: SourceFileAccess = { list: async () => ["main.tex"], read, write };
  const onDirty = jest.fn();
  const fake = fakeDocument(over);
  const element = document.createElement("div");
  const editor = await mountSourceEditor(element, {
    projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty, document: fake.document, ...extra,
  });
  const view = EditorView.findFromDOM(element)!;
  const press = (): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: "s", code: "KeyS", keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    return event;
  };
  /** A change typed by the user; each one is its own undo event. */
  const type = (from: number, insert: string, to = from): void => view.dispatch({ changes: { from, to, insert }, annotations: isolateHistory.of("full") });
  return { ...fake, editor, view, write, read, onDirty, press, type };
}

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settle = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("document mode: starting and pushing", () => {
  it("2.3a starts from the host's text, not from the file", async () => {
    const { editor, view, write } = await mount({ text: "from the host" });
    expect(view.state.doc.toString()).toBe("from the host");
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("2.3a numbers positions in LF space for a CRLF document", async () => {
    const { editor, view, push, type } = await mount({ text: "a\r\nb", lineBreak: "\r\n", version: 6 });
    expect(view.state.doc.lines).toBe(2);
    expect(view.state.doc.length).toBe(3);
    type(3, "!");
    await until(() => push.mock.calls.length > 0);
    expect(push).toHaveBeenCalledWith(6, [{ clientID: expect.any(String), changes: [{ from: 3, to: 3, insert: "!" }] }]);
    await editor.dispose();
  });

  it("2.3a typing pushes updates on top of the given version", async () => {
    const { editor, push, type } = await mount({ text: "hello", version: 3 });
    type(0, "x");
    await until(() => push.mock.calls.length > 0);
    expect(push).toHaveBeenCalledTimes(1);
    const [version, updates] = push.mock.calls[0]!;
    expect(version).toBe(3);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.clientID).toEqual(expect.any(String));
    expect(updates[0]!.clientID).not.toBe("");
    expect(updates[0]!.changes).toEqual([{ from: 0, to: 0, insert: "x" }]);
    await editor.dispose();
  });

  it("2.3a pushes a replacement and a deletion as changes", async () => {
    const { editor, push, type } = await mount({ text: "hello", version: 0 });
    type(1, "", 3);
    await until(() => push.mock.calls.length > 0);
    expect(push.mock.calls[0]![1].flatMap((u) => u.changes)).toEqual([{ from: 1, to: 3, insert: "" }]);
    await editor.dispose();
  });

  it("2.3a sends the edits of one animation frame in a single push", async () => {
    const { editor, push, type } = await mount({ text: "", version: 0 });
    type(0, "a");
    type(1, "b");
    type(2, "c");
    await until(() => push.mock.calls.length > 0);
    await settle();
    expect(push).toHaveBeenCalledTimes(1);
    const inserted = push.mock.calls[0]![1].flatMap((u) => u.changes).map((c) => c.insert).join("");
    expect(inserted).toBe("abc");
    await editor.dispose();
  });

  it("2.3a never calls files.write, not when typing, not on a flush, not on dispose", async () => {
    const { editor, write, push, host, type } = await mount({ text: "hello", version: 3 });
    type(0, "x");
    await until(() => push.mock.calls.length > 0);
    const own = push.mock.calls[0]![1];
    host.updates(4, own);
    await expect(editor.flush()).resolves.toBe(true);
    type(1, "y");
    await editor.dispose();
    await settle();
    expect(write).not.toHaveBeenCalled();
  });

  it("2.3a does not push a document with no edits", async () => {
    const { editor, push } = await mount();
    await settle();
    expect(push).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("2.3a flush resolves true once the host has confirmed the pushed updates", async () => {
    const { editor, push, host, type } = await mount({ text: "hello", version: 3 });
    type(5, "!");
    await until(() => push.mock.calls.length > 0);
    let resolved: boolean | undefined;
    const flushed = editor.flush().then((value) => { resolved = value; return value; });
    await settle();
    expect(resolved).toBeUndefined();
    host.updates(4, push.mock.calls[0]![1]);
    await expect(flushed).resolves.toBe(true);
    await editor.dispose();
  });

  it("2.3a flush resolves true at once when nothing is unconfirmed", async () => {
    const { editor } = await mount();
    await expect(editor.flush()).resolves.toBe(true);
    await editor.dispose();
  });

  it("2.3a pushes the next edit on top of the version the host confirmed", async () => {
    const { editor, push, host, type } = await mount({ text: "hello", version: 3 });
    type(0, "a");
    await until(() => push.mock.calls.length === 1);
    host.updates(4, push.mock.calls[0]![1]);
    type(1, "b");
    await until(() => push.mock.calls.length === 2);
    expect(push.mock.calls[1]![0]).toBe(4);
    expect(push.mock.calls[1]![1].flatMap((u) => u.changes)).toEqual([{ from: 1, to: 1, insert: "b" }]);
    await editor.dispose();
  });
});

describe("document mode: host updates", () => {
  it("2.3b applies a host update", async () => {
    const { editor, view, host } = await mount({ text: "hello", version: 3 });
    host.updates(4, [{ clientID: "host", changes: [{ from: 5, to: 5, insert: "!" }] }]);
    expect(view.state.doc.toString()).toBe("hello!");
    await editor.dispose();
  });

  it("2.3b applies several host updates in order", async () => {
    const { editor, view, host } = await mount({ text: "abc", version: 0 });
    host.updates(2, [
      { clientID: "host", changes: [{ from: 0, to: 0, insert: "X" }] },
      { clientID: "host", changes: [{ from: 4, to: 4, insert: "Y" }] },
    ]);
    expect(view.state.doc.toString()).toBe("XabcY");
    await editor.dispose();
  });

  it("2.3b does not send a host update back", async () => {
    const { editor, push, write, host } = await mount({ text: "hello", version: 3 });
    host.updates(4, [{ clientID: "host", changes: [{ from: 5, to: 5, insert: "!" }] }]);
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await editor.flush();
    await editor.dispose();
  });

  it("2.3b rebases the editor's unconfirmed edit over a host update, keeping both once", async () => {
    const { editor, view, host, type } = await mount({ text: "abc", version: 0 });
    type(0, "Y");
    host.updates(1, [{ clientID: "host", changes: [{ from: 3, to: 3, insert: "X" }] }]);
    expect(view.state.doc.toString()).toBe("YabcX");
    await editor.dispose();
  });

  it("2.3b undo does not take a host update back, and own edits before and after it still undo", async () => {
    const { editor, view, host, type } = await mount({ text: "hello", version: 3 });
    type(0, "A");
    expect(view.state.doc.toString()).toBe("Ahello");
    host.updates(4, [{ clientID: "host", changes: [{ from: 5, to: 5, insert: "!" }] }]);
    expect(view.state.doc.toString()).toBe("Ahello!");
    type(view.state.doc.length, "B");
    expect(view.state.doc.toString()).toBe("Ahello!B");

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Ahello!");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello!");
    undo(view);
    expect(view.state.doc.toString()).toBe("hello!");
    await editor.dispose();
  });

  it("2.3b has nothing to undo after only host updates", async () => {
    const { editor, view, host } = await mount({ text: "hello", version: 3 });
    host.updates(4, [{ clientID: "host", changes: [{ from: 0, to: 0, insert: ">" }] }]);
    host.updates(5, [{ clientID: "host", changes: [{ from: 6, to: 6, insert: "<" }] }]);
    expect(view.state.doc.toString()).toBe(">hello<");
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(">hello<");
    await editor.dispose();
  });
});

describe("document mode: save and dirty", () => {
  it("2.3c Mod-s calls document.save once and keeps the browser dialog closed", async () => {
    const { editor, save, write, press } = await mount();
    const event = press();
    expect(event.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    await editor.flush();
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("2.3c Mod-s after typing calls document.save and does not write the file", async () => {
    const { editor, save, write, press, type } = await mount();
    type(0, "x");
    press();
    expect(save).toHaveBeenCalledTimes(1);
    await settle();
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("2.3c the dirty flag follows the host's messages", async () => {
    const { editor, host, onDirty } = await mount({ dirty: false });
    host.dirty(true);
    expect(onDirty).toHaveBeenLastCalledWith(true);
    host.dirty(false);
    expect(onDirty).toHaveBeenLastCalledWith(false);
    host.dirty(true);
    expect(onDirty).toHaveBeenLastCalledWith(true);
    await editor.dispose();
  });

  it("2.3c typing alone does not mark the editor dirty; the host does", async () => {
    const { editor, host, onDirty, type } = await mount({ dirty: false });
    type(0, "x");
    await settle();
    expect(onDirty).not.toHaveBeenCalledWith(true);
    host.dirty(true);
    expect(onDirty).toHaveBeenLastCalledWith(true);
    await editor.dispose();
  });
});

describe("document mode: resync", () => {
  it("2.3d a resync replaces the text", async () => {
    const { editor, view, host } = await mount({ text: "old text", version: 3 });
    host.resync("brand new text", 10);
    expect(view.state.doc.toString()).toBe("brand new text");
    await editor.dispose();
  });

  it("2.3d a resync keeps the cursor at the same line and column", async () => {
    const { editor, view, host } = await mount({ text: "line one\nline two\nline three", version: 3 });
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 3 } });
    host.resync("new first\nnew second line\nnew third", 10);
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    expect(line.number).toBe(2);
    expect(head - line.from).toBe(3);
    await editor.dispose();
  });

  it("2.3d a resync that removes the cursor's line leaves a cursor inside the document", async () => {
    const { editor, view, host } = await mount({ text: "one\ntwo\nthree\nfour", version: 3 });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    host.resync("only", 10);
    expect(view.state.doc.toString()).toBe("only");
    expect(view.state.selection.main.head).toBeLessThanOrEqual(4);
    await editor.dispose();
  });

  it("2.3d a resync is not sent back and does not write the file", async () => {
    const { editor, host, push, write } = await mount({ text: "old", version: 3 });
    host.resync("new", 10);
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("2.3d edits after a resync are pushed on top of the resync's version", async () => {
    const { editor, host, push, type } = await mount({ text: "old", version: 3 });
    host.resync("new", 10);
    type(3, "!");
    await until(() => push.mock.calls.length > 0);
    expect(push.mock.calls[0]![0]).toBe(10);
    expect(push.mock.calls[0]![1].flatMap((u) => u.changes)).toEqual([{ from: 3, to: 3, insert: "!" }]);
    await editor.dispose();
  });
});
