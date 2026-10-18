/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The source editor marks the lines of unresolved comments, moves the marks with edits and adds comments on the selection.
import { EditorView } from "@codemirror/view";
import type { TextRange, ILogger } from "@labshelf/core";
import type { EditorComments } from "../../../src/library-page/editor/commentSupport";
import { mountSourceEditor, type SourceFileAccess } from "../../../src/library-page/editor/mountSourceEditor";

const mockInputBox = jest.fn<Promise<string | undefined>, []>();
jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), inputBox: () => mockInputBox() }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

async function mount(text: string, ranges: TextRange[], extra: { onSaved?: () => void } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const added: Array<{ range: TextRange; text: string }> = [];
  const open = jest.fn();
  const comments: EditorComments = {
    subscribe: (listener) => { listener(ranges); return () => undefined; },
    add: async (range, body) => { added.push({ range, text: body }); },
    open,
  };
  const written: string[] = [];
  const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => text, write: async (_p, content) => { written.push(content); } };
  const editor = await mountSourceEditor(host, {
    projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: () => undefined, comments, ...extra,
  });
  return { editor, host, view: EditorView.findFromDOM(host)!, added, open, written };
}

const markedText = (host: HTMLElement): string => [...host.querySelectorAll(".ls-comment-range")].map((node) => node.textContent).join("|");
const markedLines = (host: HTMLElement): number => host.querySelectorAll(".ls-comment-marker").length;

describe("comment marks", () => {
  it("marks the anchored range and the gutter of its line", async () => {
    const { editor, host } = await mount("one\ntwo\nthree\n", [{ start: 4, end: 7 }]);
    expect(markedText(host)).toBe("two");
    expect(markedLines(host)).toBe(1);
    await editor.dispose();
  });

  it("moves the marks with an edit before them", async () => {
    const { editor, host, view } = await mount("one\ntwo\n", [{ start: 4, end: 7 }]);
    view.dispatch({ changes: { from: 0, insert: "zero\n" } });
    expect(markedText(host)).toBe("two");
    await editor.dispose();
  });

  it("places ranges of a CRLF file on the LF document", async () => {
    const { editor, host } = await mount("one\r\ntwo\r\n", [{ start: 5, end: 8 }]);
    expect(markedText(host)).toBe("two");
    await editor.dispose();
  });

  it("opens the comments tab from a gutter marker", async () => {
    const { editor, host, open } = await mount("one\ntwo\n", [{ start: 4, end: 7 }]);
    host.querySelector<HTMLElement>(".ls-comment-marker")!.click();
    expect(open).toHaveBeenCalledTimes(1);
    await editor.dispose();
  });
});

describe("add comment", () => {
  const button = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".ls-add-comment")!;

  it("is disabled while the selection is empty", async () => {
    const { editor, host, view } = await mount("one\ntwo\n", []);
    expect(button(host).disabled).toBe(true);
    view.dispatch({ selection: { anchor: 4, head: 7 } });
    expect(button(host).disabled).toBe(false);
    await editor.dispose();
  });

  it("adds the typed text on the selection, in file offsets, after saving", async () => {
    mockInputBox.mockResolvedValue("check this");
    const { editor, host, view, added, written } = await mount("one\r\ntwo\r\n", []);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    view.dispatch({ selection: { anchor: 5, head: 8 } });
    button(host).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written).toEqual(["xone\r\ntwo\r\n"]);
    expect(added).toEqual([{ range: { start: 6, end: 9 }, text: "check this" }]);
    await editor.dispose();
  });

  it("adds nothing when the input is cancelled", async () => {
    mockInputBox.mockResolvedValue(undefined);
    const { editor, host, view, added } = await mount("one\ntwo\n", []);
    view.dispatch({ selection: { anchor: 4, head: 7 } });
    button(host).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(added).toEqual([]);
    await editor.dispose();
  });
});

describe("saved hook", () => {
  it("runs after a successful save", async () => {
    const onSaved = jest.fn();
    const { editor, view } = await mount("a", [], { onSaved });
    view.dispatch({ changes: { from: 0, insert: "b" } });
    await editor.flush();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await editor.dispose();
  });
});
