/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Cmd/Ctrl+S writes the pending edit now and asks the helper for a full build, without opening the browser's save dialog.
import { EditorView } from "@codemirror/view";
import type { ILogger, PresenceStore } from "@labshelf/core";
import * as Y from "yjs";
import { mountSourceEditor, type SourceEditorDeps, type SourceFileAccess } from "../../../../src/writing/dom/sourceEditor/editor";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const ready = { state: "ready" as const, helperVersion: "1", tex: { source: "none" as const, complete: false }, host: "helper" as const };

async function mount(extra: Partial<SourceEditorDeps> = {}) {
  const write = jest.fn(async () => undefined);
  const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => "one", write };
  const helper = { status: () => ready, edit: jest.fn(async () => undefined), save: jest.fn(async () => undefined) };
  const host = document.createElement("div");
  const editor = await mountSourceEditor(host, { projectId: "p", path: "main.tex", files, papers: async () => [], helper, logger, onDirty: () => undefined, ...extra });
  const view = EditorView.findFromDOM(host)!;
  const press = (): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key: "s", code: "KeyS", keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    return event;
  };
  return { editor, view, write, helper, press };
}

describe("save shortcut", () => {
  it("writes a pending edit once and sends one helper save, and keeps the browser dialog closed", async () => {
    const { editor, view, write, helper, press } = await mount();
    view.dispatch({ changes: { from: 0, insert: "x" } });
    const event = press();
    expect(event.defaultPrevented).toBe(true);
    await editor.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("main.tex", "xone");
    expect(helper.save).toHaveBeenCalledTimes(1);
    expect(helper.save).toHaveBeenCalledWith("p", "main.tex", true);
    await editor.dispose();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("tells the helper an autosave is not an explicit save", async () => {
    const { editor, view, write, helper } = await mount();
    view.dispatch({ changes: { from: 0, insert: "x" } });
    await editor.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(helper.save).toHaveBeenCalledTimes(1);
    expect(helper.save).toHaveBeenCalledWith("p", "main.tex", false);
    await editor.dispose();
  });

  it("asks for a build when nothing is pending", async () => {
    const { editor, write, helper, press } = await mount();
    press();
    await editor.flush();
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    expect(helper.save).toHaveBeenCalledTimes(1);
    expect(helper.save).toHaveBeenCalledWith("p", "main.tex", true);
    await editor.dispose();
  });

  it("asks for a build on a shared file, which the share writes itself", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "shared");
    const presence = { awareness: { clientID: 7, on: () => undefined, off: () => undefined }, setLocal: () => undefined, remote: () => new Map() } as unknown as PresenceStore;
    const { editor, write, helper, press } = await mount({ collab: { text, presence, name: "Ada" } });
    press();
    await editor.flush();
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    expect(helper.save).toHaveBeenCalledTimes(1);
    expect(helper.save).toHaveBeenCalledWith("p", "main.tex", true);
    await editor.dispose();
  });

  it("does nothing more than keep the dialog closed when no helper is connected", async () => {
    const { editor, view, write, press } = await mount({ helper: undefined });
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(press().defaultPrevented).toBe(true);
    await editor.flush();
    expect(write).toHaveBeenCalledTimes(1);
    await editor.dispose();
  });
});
