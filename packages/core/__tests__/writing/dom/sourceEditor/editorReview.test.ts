/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The editor's review dep: the port's suggestions load into the editor, reviewing edits reach the port after the save in saved-file offsets, accept and reject remove them.
import { EditorView } from "@codemirror/view";
import type { ILogger } from "@labshelf/core";
import { mountSourceEditor, type SourceEditorDeps, type SourceFileAccess } from "../../../../src/writing/dom/sourceEditor/editor";
import type { EditorReview, FileSuggestion, ReviewMode } from "../../../../src/writing/dom/sourceEditor/review";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const created = "2026-10-30T10:00:00.000Z";

function fakePort(initial: readonly FileSuggestion[] = []) {
  let listener: ((list: readonly FileSuggestion[]) => void) | undefined;
  const add = jest.fn(async (_suggestions: readonly FileSuggestion[]) => undefined);
  const remove = jest.fn(async (_ids: readonly string[]) => undefined);
  const subscribe = jest.fn((next: (list: readonly FileSuggestion[]) => void) => {
    listener = next;
    next(initial);
    return () => { listener = undefined; };
  });
  return { suggestions: { subscribe, add, remove }, add, remove, subscribe, emit: (list: readonly FileSuggestion[]) => listener?.(list) };
}

async function mount(fileText: string, mode: ReviewMode, initial: readonly FileSuggestion[] = [], extra: Partial<SourceEditorDeps> = {}) {
  const write = jest.fn(async (_path: string, _text: string) => undefined);
  const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => fileText, write };
  const port = fakePort(initial);
  const onMode = jest.fn();
  const review: EditorReview = { author: () => "Ana", mode, suggestions: port.suggestions, onMode };
  const host = document.createElement("div");
  document.body.append(host);
  const editor = await mountSourceEditor(host, { projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: () => undefined, review, ...extra });
  const view = EditorView.findFromDOM(host)!;
  return { editor, view, write, port, onMode };
}

const type = (view: EditorView, at: number, text: string): void => {
  view.dispatch({ changes: { from: at, insert: text }, userEvent: "input.type" });
};
const button = (view: EditorView, label: string): HTMLButtonElement =>
  [...view.dom.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;

afterEach(() => { document.body.replaceChildren(); });

describe("editor review", () => {
  it("sends a reviewing edit to the port after the save, in the saved file's CRLF offsets", async () => {
    const { editor, view, write, port } = await mount("one\r\ntwo", "reviewing");
    type(view, 4, "X");
    expect(port.add).not.toHaveBeenCalled();
    await editor.flush();
    expect(write).toHaveBeenCalledWith("main.tex", "one\r\nXtwo");
    expect(port.add).toHaveBeenCalledTimes(1);
    expect(port.add.mock.calls[0]![0]).toEqual([expect.objectContaining({ kind: "insert", start: 5, end: 6, author: "Ana" })]);
    await editor.dispose();
    expect(port.add).toHaveBeenCalledTimes(1);
  });

  it("loads the port's list into the editor, converting file offsets", async () => {
    const list: FileSuggestion[] = [{ id: "s1", kind: "insert", start: 5, end: 8, author: "Bo", created }];
    const { editor, view, port } = await mount("one\r\ntwo", "editing", list);
    expect(port.subscribe).toHaveBeenCalledTimes(1);
    expect(view.dom.querySelector(".ls-review-insert")?.textContent).toBe("two");
    port.emit([{ id: "s2", kind: "delete", start: 3, end: 3, text: "old", author: "Bo", created }]);
    expect(view.dom.querySelector(".ls-review-insert")).toBeNull();
    expect(view.dom.querySelector(".ls-review-delete")?.textContent).toBe("old");
    await editor.dispose();
  });

  it("sends remove for an accepted suggestion", async () => {
    const list: FileSuggestion[] = [{ id: "s1", kind: "insert", start: 0, end: 3, author: "Bo", created }];
    const { editor, view, port } = await mount("one two", "editing", list);
    button(view, "Accept all").click();
    await editor.flush();
    expect(port.remove).toHaveBeenCalledWith(["s1"]);
    expect(port.add).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("one two");
    await editor.dispose();
  });

  it("sends remove for a rejected suggestion after the reverted text is saved", async () => {
    const list: FileSuggestion[] = [{ id: "s1", kind: "insert", start: 0, end: 4, author: "Bo", created }];
    const { editor, view, write, port } = await mount("one two", "editing", list);
    button(view, "Reject all").click();
    expect(port.remove).not.toHaveBeenCalled();
    await editor.flush();
    expect(write).toHaveBeenCalledWith("main.tex", "two");
    expect(port.remove).toHaveBeenCalledWith(["s1"]);
    expect(port.add).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("does not resend what the port already holds", async () => {
    const list: FileSuggestion[] = [{ id: "s1", kind: "insert", start: 0, end: 3, author: "Bo", created }];
    const { editor, view, port } = await mount("one two", "editing", list);
    type(view, 7, "!");
    await editor.flush();
    expect(port.add).not.toHaveBeenCalled();
    expect(port.remove).not.toHaveBeenCalled();
    await editor.dispose();
  });

  it("switches tracking with setReviewMode on the same view", async () => {
    const { editor, view, port } = await mount("one", "editing");
    type(view, 0, "a");
    await editor.flush();
    expect(port.add).not.toHaveBeenCalled();
    editor.setReviewMode("reviewing");
    type(view, 1, "b");
    await editor.flush();
    expect(port.add).toHaveBeenCalledTimes(1);
    expect(port.add.mock.calls[0]![0]).toEqual([expect.objectContaining({ kind: "insert", start: 1, end: 2 })]);
    expect(EditorView.findFromDOM(view.dom.parentElement!)).toBe(view);
    await editor.dispose();
  });

  it("tracks a toolbar insert while reviewing", async () => {
    const { editor, port } = await mount("one", "reviewing");
    editor.insertText("Z");
    await editor.flush();
    expect(port.add.mock.calls[0]![0]).toEqual([expect.objectContaining({ kind: "insert", start: 0, end: 1 })]);
    await editor.dispose();
  });

  it("offers the mode dropdown; a pick switches the mode and tells the host", async () => {
    const { editor, view, port, onMode } = await mount("one", "editing");
    const dropdown = editor.reviewDropdown!;
    expect(dropdown.current()).toBe("editing");
    dropdown.pick("reviewing");
    expect(onMode).toHaveBeenCalledWith("reviewing");
    expect(dropdown.current()).toBe("reviewing");
    type(view, 0, "a");
    await editor.flush();
    expect(port.add).toHaveBeenCalledTimes(1);
    await editor.dispose();
  });

  it("gives a read-only editor no review", async () => {
    const list: FileSuggestion[] = [{ id: "s1", kind: "insert", start: 0, end: 3, author: "Bo", created }];
    const { editor, view, port } = await mount("one", "reviewing", list, { readOnly: true });
    expect(port.subscribe).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".ls-review-insert")).toBeNull();
    expect(editor.reviewDropdown).toBeUndefined();
    await editor.dispose();
  });
});
