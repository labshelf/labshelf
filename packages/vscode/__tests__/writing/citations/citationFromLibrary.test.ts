// Tests that Cite from Library inserts the picked citation at every cursor and then updates the bibliography.
import * as vscode from "vscode";

import { registerCitationFromLibrary } from "../../../src/writing/citations/index";
import { UPDATE_BIBLIOGRAPHY_COMMAND } from "../../../src/writing/citations/citationCompletion";
import { citationWorkspace, highlight, PAPERS } from "../../support/citationFixtures";
import { commandHandler } from "../../support/writingFixtures";

const window = vscode.window as unknown as Record<string, jest.Mock> & { activeTextEditor: unknown };

interface FakePicker {
  items: Array<{ label: string; description?: string; highlight?: unknown; buttons?: unknown[] }>;
  selectedItems: unknown[];
  accept: Array<() => void>; button: Array<(event: { item: unknown }) => void>; hide: Array<() => void>;
}

/** A quick pick that runs `act` once shown, as the user would. */
function fakePicker(act: (picker: FakePicker) => void): FakePicker {
  const picker: FakePicker = { items: [], selectedItems: [], accept: [], button: [], hide: [] };
  window["createQuickPick"]!.mockImplementation(() => ({
    get items() { return picker.items; },
    set items(value) { picker.items = value; },
    get selectedItems() { return picker.selectedItems; },
    onDidAccept: (fn: () => void) => picker.accept.push(fn),
    onDidTriggerItemButton: (fn: (event: { item: unknown }) => void) => picker.button.push(fn),
    onDidHide: (fn: () => void) => picker.hide.push(fn),
    show: () => act(picker),
    hide: () => picker.hide.forEach((fn) => fn()),
    dispose: jest.fn(),
  }));
  return picker;
}

function setup(format: "latex" | "typst", annotations = {}) {
  const workspace = citationWorkspace(format, PAPERS, annotations);
  const edits: string[] = [];
  const selections = [{ id: 1 }, { id: 2 }];
  const edit = jest.fn(async (build: (builder: { replace: (selection: unknown, text: string) => void }) => void) => {
    build({ replace: (_selection, text) => edits.push(text) });
    return true;
  });
  const file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ";
  window.activeTextEditor = { document: { uri: { fsPath: file } }, selections, edit };
  registerCitationFromLibrary({ subscriptions: [] } as never, workspace);
  return { edits, edit, workspace };
}

beforeEach(() => {
  jest.clearAllMocks();
  window["createQuickPick"] = jest.fn();
  window["showQuickPick"]!.mockImplementation(async (items: Array<{ paper: { citeKey: string } }>) => items[0]);
});

describe("labshelf.writing.citeFromLibrary", () => {
  it("lists each paper with its key and status and inserts a plain citation at every cursor when it has no highlight", async () => {
    const { edits } = setup("latex");

    await commandHandler("labshelf.writing.citeFromLibrary")();

    const [items] = window["showQuickPick"]!.mock.calls[0]!;
    expect(items[0]).toMatchObject({ label: "Attention Is All You Need", description: "@vaswani2017", detail: "Unread · 2017" });
    expect(edits).toEqual(["\\cite{vaswani2017}", "\\cite{vaswani2017}"]);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(UPDATE_BIBLIOGRAPHY_COMMAND, expect.anything());
  });

  it("cites the page of the accepted highlight, and quotes it when its button is clicked", async () => {
    const { edits } = setup("typst", { p1: [highlight(), highlight({ id: "h2", type: "note" }), highlight({ id: "h3", content: "  " })] });
    const picker = fakePicker(({ items, selectedItems, accept }) => { selectedItems.push(items[1]); accept.forEach((fn) => fn()); });

    await commandHandler("labshelf.writing.citeFromLibrary")();

    expect(picker.items.map((item) => item.label)).toEqual(["Cite without a page", "Attention is all you need"]);
    expect(picker.items[1]).toMatchObject({ description: "p. 4" });
    expect(edits).toEqual(["@vaswani2017[p. 4]", "@vaswani2017[p. 4]"]);

    edits.length = 0;
    fakePicker(({ items, button }) => button.forEach((fn) => fn({ item: items[1] })));
    await commandHandler("labshelf.writing.citeFromLibrary")();
    expect(edits[0]).toBe('"Attention is all you need" @vaswani2017[p. 4]');
  });

  it("inserts a citation without a page for the first item and nothing when the pick is dismissed", async () => {
    const { edits } = setup("latex", { p1: [highlight()] });
    fakePicker(({ items, selectedItems, accept }) => { selectedItems.push(items[0]); accept.forEach((fn) => fn()); });
    await commandHandler("labshelf.writing.citeFromLibrary")();
    expect(edits[0]).toBe("\\cite{vaswani2017}");

    edits.length = 0;
    fakePicker(({ hide }) => hide.forEach((fn) => fn()));
    await commandHandler("labshelf.writing.citeFromLibrary")();
    expect(edits).toEqual([]);
  });

  it("does nothing outside a project source", async () => {
    const { edit } = setup("latex");
    window.activeTextEditor = { document: { uri: { fsPath: "/elsewhere/a.tex" } }, selections: [], edit };

    await commandHandler("labshelf.writing.citeFromLibrary")();

    expect(window["showQuickPick"]).not.toHaveBeenCalled();
  });

  it("logs a warning and skips the bibliography update when the editor rejects the edit", async () => {
    const { edit, workspace } = setup("latex");
    edit.mockResolvedValue(false);

    await commandHandler("labshelf.writing.citeFromLibrary")();

    expect(workspace.logger.log).toHaveBeenCalledWith("WARN", "citations", expect.any(String), expect.anything());
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});
