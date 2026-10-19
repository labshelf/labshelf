/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A history restore saves the project's open editors first and reloads them after, so no stale editor overwrites the restore.
import { EditorView } from "@codemirror/view";
import type { HistoryToHost, HostToHistory, ILogger } from "@labshelf/core";
import { createLoopbackTransport } from "@labshelf/core";
import { confirmDialog } from "@labshelf/core/dom";
import { mountSourceEditor, type SourceFileAccess } from "../../../../src/library-page/editor/mountSourceEditor";
import { mountHistoryHost } from "../../../../src/library-page/review/history";
import { clearFakeDb } from "../../../support/fakeIdb";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

jest.mock("@labshelf/core/dom", () => ({ toast: jest.fn(), confirmDialog: jest.fn(), inputBox: jest.fn() }));
jest.mock("../../../../src/storage/idb/db", () => ({ getDb: async () => require("../../../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const project = { id: "thesis", folder: "proj" };
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function setup() {
  const fs = memoryLibraryFs();
  const { ui, host } = createLoopbackTransport<HistoryToHost, HostToHistory>();
  const rows: Extract<HostToHistory, { type: "history" }>["rows"][] = [];
  ui.subscribe((message) => { if (message.type === "history") rows.push(message.rows); });
  mountHistoryHost({ fs, logger, endpoint: host, project, lastFullPdf: () => undefined });
  await fs.writeText("proj/main.tex", "one");
  ui.post({ type: "ready" });
  await settle();
  await fs.writeText("proj/main.tex", "two");
  const files: SourceFileAccess = {
    list: async () => ["main.tex"],
    read: (path) => fs.readText(`proj/${path}`),
    write: (path, text) => fs.writeText(`proj/${path}`, text),
  };
  const editorHost = document.createElement("div");
  const editor = await mountSourceEditor(editorHost, { projectId: project.id, path: "main.tex", files, papers: async () => [], helper: undefined, logger, onDirty: () => undefined });
  const view = EditorView.findFromDOM(editorHost)!;
  return { fs, ui, rows, editor, view, firstId: rows[0]![0]!.id };
}

beforeEach(() => { clearFakeDb(); jest.clearAllMocks(); (confirmDialog as jest.Mock).mockResolvedValue(true); });

describe("history restore with an open editor", () => {
  it("reloads the editor with the restored text, and a later save writes from it", async () => {
    const { fs, ui, editor, view, firstId } = await setup();
    expect(view.state.doc.toString()).toBe("two");
    ui.post({ type: "restore", id: firstId });
    await settle();
    expect(view.state.doc.toString()).toBe("one");
    view.dispatch({ changes: { from: 3, insert: "!" } });
    await editor.flush();
    expect(await fs.readText("proj/main.tex")).toBe("one!");
    await editor.dispose();
  });

  it("saves the editor's unsaved edit before restoring, so the history keeps it", async () => {
    const { fs, ui, rows, editor, view, firstId } = await setup();
    view.dispatch({ changes: { from: 3, insert: " unsaved" } });
    ui.post({ type: "restore", id: firstId });
    await settle();
    expect(await fs.readText("proj/main.tex")).toBe("one");
    expect(view.state.doc.toString()).toBe("one");
    expect(rows.at(-1)!.length).toBe(3);
    await editor.dispose();
  });
});
