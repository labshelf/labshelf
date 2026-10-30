// Tests "Insert from note" (picker, inserted text), the marks on inserted copies, their hover and the "Update from note" code action.
import * as vscode from "vscode";

import { buildInsert, scanOrigins } from "@labshelf/core";
import { registerNoteLinks } from "../../../src/writing/citations/noteLinks";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";
import { fakeDocument } from "../../support/textDocument";

const FOLDER = "/p/proj";
const FILE = `${FOLDER}/main.tex`;
const NOTE_PATH = "notes.qmd";
const NOTE = (latex: string): string => `# Notes\n\n$$ ${latex} $$ {#eq-energy}\n`;
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) { await new Promise((resolve) => setImmediate(resolve)); } };

type Mocked = jest.Mock<unknown, unknown[]>;

function providerOf(register: unknown): any {
  const calls = (register as Mocked).mock.calls;
  return calls[calls.length - 1]![1];
}

describe("note links", () => {
  async function setup(noteLatex: string, manuscript: (inserted: string) => string, insertedFrom = "E = mc^2") {
    const logger = fakeLogger();
    const projects = fakeProjects([readyEntry(FOLDER)]);
    const notes = {
      list: jest.fn(async () => [{ path: NOTE_PATH, title: "Notes" }]),
      read: jest.fn(async () => NOTE(noteLatex)),
    };
    const context = { subscriptions: [] as unknown[] } as unknown as vscode.ExtensionContext;
    registerNoteLinks(context, { projects: projects as never, notes: notes as never, logger, library: () => undefined });
    const inserted = await buildInsert({ notePath: NOTE_PATH, label: "eq-energy", latex: insertedFrom, source: "equation", title: "Notes" }, "latex");
    const text = manuscript(inserted);
    const document = Object.assign(fakeDocument(FILE, text), { languageId: "latex" });
    const collection = (vscode.languages.createDiagnosticCollection as Mocked).mock.results.slice(-1)[0]!.value as { set: jest.Mock };
    return { document, text, collection, notes, logger };
  }

  async function open(document: vscode.TextDocument): Promise<void> {
    (vscode.workspace as unknown as { _fireDocumentEvent: (kind: string, doc: unknown) => void })._fireDocumentEvent("open", document);
    await flush();
  }

  beforeEach(() => { jest.clearAllMocks(); });

  it("marks nothing for a copy that matches its note", async () => {
    const { document, collection } = await setup("E = mc^2", (inserted) => `Text\n${inserted}\n`);
    await open(document);
    expect(collection.set).toHaveBeenLastCalledWith(document.uri, []);
    const hover = providerOf(vscode.languages.registerHoverProvider).provideHover(document, new vscode.Position(5, 80));
    expect(hover).toBeUndefined();
  });

  it("marks a stale copy as information and offers the update with the inserted range", async () => {
    const { document, text, collection } = await setup("E = mc^3", (inserted) => `Text\n${inserted}\n`);
    await open(document);
    const [, marks] = collection.set.mock.calls.slice(-1)[0] as [unknown, vscode.Diagnostic[]];
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ severity: vscode.DiagnosticSeverity.Information, source: "LabShelf", code: "stale" });
    expect(marks[0]!.message).toContain("eq-energy: the note changed since it was inserted");

    const origin = scanOrigins("latex", text)[0]!;
    const actions: vscode.CodeAction[] = await providerOf(vscode.languages.registerCodeActionsProvider)
      .provideCodeActions(document, marks[0]!.range, { diagnostics: marks });
    expect(actions.map((action) => action.title)).toEqual(["Update from note", "Show differences"]);
    expect(JSON.stringify(actions[0]!.edit)).toContain("E = mc^3");
    expect(JSON.stringify(actions[0]!.edit)).toContain(String(origin.insertedRange.end.character));

    const hover = providerOf(vscode.languages.registerHoverProvider).provideHover(document, new vscode.Position(origin.line, origin.insertedRange.end.character));
    const value = (hover.contents as vscode.MarkdownString).value;
    expect(value).toContain("Update from note");
    expect(value).toContain("Show differences");
  });

  it("warns about an edited copy and never offers to overwrite it", async () => {
    const { document, collection } = await setup("E = mc^2", (inserted) => `Text\n${inserted.replace("E = mc^2", "E = m c^2")}\n`);
    await open(document);
    const [, marks] = collection.set.mock.calls.slice(-1)[0] as [unknown, vscode.Diagnostic[]];
    expect(marks[0]).toMatchObject({ severity: vscode.DiagnosticSeverity.Warning, code: "diverged" });
    const actions: vscode.CodeAction[] = await providerOf(vscode.languages.registerCodeActionsProvider)
      .provideCodeActions(document, marks[0]!.range, { diagnostics: marks });
    expect(actions.map((action) => action.title)).toEqual(["Show differences"]);
    const hover = providerOf(vscode.languages.registerHoverProvider).provideHover(document, new vscode.Position(scanOrigins("latex", document.getText())[0]!.line, 90));
    expect((hover.contents as vscode.MarkdownString).value).not.toContain("Update from note");
  });

  describe("Insert from note", () => {
    function activeEditor(text: string, line: number, character: number) {
      const document = Object.assign(fakeDocument(FILE, text), { languageId: "latex" });
      const position = new vscode.Position(line, character);
      const editor = {
        document, selection: { start: position, end: position },
        edit: jest.fn(async (callback: (builder: unknown) => void) => { callback({ replace: jest.fn() }); return true; }),
      };
      (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = editor;
      return editor;
    }

    function handler(): () => Promise<void> {
      const call = (vscode.commands.registerCommand as Mocked).mock.calls.filter(([name]) => name === "labshelf.writing.insertFromNote").pop()!;
      return call[1] as () => Promise<void>;
    }

    it("lists equations under a separator and inserts the picked one on its own lines", async () => {
      await setup("E = mc^2", (inserted) => inserted);
      const editor = activeEditor("before after", 0, 6);
      const showQuickPick = jest.fn(async (entries: unknown[], _options?: unknown) => entries[1]);
      (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = showQuickPick;
      await handler()();
      const entries = showQuickPick.mock.calls[0]![0] as { label: string; description?: string; kind?: number }[];
      expect(entries.map((entry) => entry.label)).toEqual(["Equations", "eq-energy"]);
      expect(entries[0]!.kind).toBe(vscode.QuickPickItemKind.Separator);
      expect(entries[1]!.description).toBe("Notes");
      expect(showQuickPick.mock.calls[0]![1]).toMatchObject({ title: "Insert from note" });

      const replace = jest.fn();
      await (editor.edit.mock.calls[0]![0] as (builder: unknown) => void)({ replace });
      const text = replace.mock.calls[0]![1] as string;
      expect(text.startsWith("\n\\begin{equation}\nE = mc^2\n\\label{eq-energy}\n\\end{equation} ")).toBe(true);
      expect(text.endsWith("\n")).toBe(true);
    });

    it("shows a message and no picker when the notes hold nothing to insert", async () => {
      const { notes } = await setup("E = mc^2", (inserted) => inserted);
      notes.list.mockResolvedValue([]);
      activeEditor("", 0, 0);
      const showQuickPick = jest.fn();
      (vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = showQuickPick;
      await handler()();
      expect(showQuickPick).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("No equations or outputs found in this project's notes or the cited papers' notes.");
    });
  });
});
