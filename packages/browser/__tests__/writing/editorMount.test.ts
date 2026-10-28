/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The source editor saves a file with the line endings it was read with, flushes on demand and reveals a line.
import { EditorView } from "@codemirror/view";
import type { ILogger } from "@labshelf/core";
import type { HelperChange } from "@labshelf/core/helper";
import { mountSourceEditor, type SourceFileAccess } from "../../src/writing/editor";
import { showInOpenEditor } from "../../src/writing/session";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

async function mount(text: string, write: SourceFileAccess["write"] = async () => undefined) {
  const written: string[] = [];
  const files: SourceFileAccess = {
    list: async () => ["main.tex"], read: async () => text,
    write: async (path, content) => { written.push(content); await write(path, content); },
  };
  const host = document.createElement("div");
  const dirty: boolean[] = [];
  const editor = await mountSourceEditor(host, { projectId: "p", path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: (d) => dirty.push(d) });
  const view = EditorView.findFromDOM(host)!;
  return { editor, view, written, dirty };
}

describe("source editor", () => {
  it("keeps CRLF line endings when the file is saved after an edit", async () => {
    const { editor, view, written } = await mount("one\r\ntwo\r\nthree\r\n");
    expect(view.state.doc.lines).toBe(4);
    view.dispatch({ changes: { from: 3, insert: "!" } });
    expect(await editor.flush()).toBe(true);
    expect(written).toEqual(["one!\r\ntwo\r\nthree\r\n"]);
    await editor.dispose();
  });

  it("keeps LF files as they are", async () => {
    const { editor, view, written } = await mount("one\ntwo\n");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    await editor.flush();
    expect(written).toEqual(["xone\ntwo\n"]);
    await editor.dispose();
  });

  it("reports a failed write: the file stays dirty", async () => {
    const { editor, view, dirty } = await mount("a", async () => { throw new Error("disk full"); });
    view.dispatch({ changes: { from: 0, insert: "b" } });
    expect(await editor.flush()).toBe(false);
    expect(dirty).toEqual([true]);
    await editor.dispose();
  });

  it("selects the line an outline click asks for", async () => {
    const { editor, view } = await mount("a\nbb\nccc\n");
    showInOpenEditor("p", "main.tex", 1);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("bb");
    await editor.dispose();
  });

  it("sends the helper the LF text of a CRLF file first, then edits at LF offsets", async () => {
    const edits: HelperChange[] = [];
    const helper = {
      status: () => ({ state: "ready" as const, helperVersion: "1", tex: { source: "none" as const, complete: false }, host: "helper" as const }),
      edit: jest.fn(async (_id: string, _path: string, _version: number, edit: HelperChange) => { edits.push(edit); }),
      save: jest.fn(async () => undefined),
    };
    const files: SourceFileAccess = { list: async () => ["main.tex"], read: async () => "one\r\ntwo\r\n", write: async () => undefined };
    const host = document.createElement("div");
    const editor = await mountSourceEditor(host, { projectId: "p", path: "main.tex", files, papers: async () => [], helper, logger, onDirty: () => undefined });
    const view = EditorView.findFromDOM(host)!;
    expect(edits).toEqual([{ text: "one\ntwo\n" }]);
    view.dispatch({ changes: { from: 4, insert: "!" } });
    expect(edits[1]).toEqual({ changes: [{ from: 4, to: 4, insert: "!" }] });
    await editor.dispose();
  });
});
