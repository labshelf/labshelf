// Tests the activeSource registry: which source editor is current, how a native editor is wrapped, and how an open LabShelf view is found by uri.
import * as vscode from "vscode";

import { createActiveSource, type SourceView } from "../../src/writing/activeSource";

function nativeEditor(file: string, line: number) {
  return {
    document: { uri: vscode.Uri.file(file), languageId: "latex" },
    selection: new vscode.Selection(new vscode.Position(line, 0), new vscode.Position(line, 2)),
    revealRange: jest.fn(),
    edit: jest.fn(async () => true),
    insertSnippet: jest.fn(async () => true),
  };
}

type FakeNative = ReturnType<typeof nativeEditor>;

function harness(initial?: FakeNative) {
  const activeChange = new vscode.EventEmitter<FakeNative | undefined>();
  const selectionChange = new vscode.EventEmitter<{ textEditor: FakeNative }>();
  const window = {
    activeTextEditor: initial as unknown,
    onDidChangeActiveTextEditor: activeChange.event,
    onDidChangeTextEditorSelection: selectionChange.event,
  };
  const source = createActiveSource(window as unknown as Parameters<typeof createActiveSource>[0]);
  const focusNative = (editor: FakeNative | undefined) => {
    window.activeTextEditor = editor;
    activeChange.fire(editor);
  };
  return { source, window, focusNative, selectionChange };
}

function labshelfView(file: string, line = 1): SourceView & { reveal: jest.Mock } {
  return { uri: vscode.Uri.file(file), line: () => line, reveal: jest.fn() };
}

describe("activeSource", () => {
  it("3.3a current() is undefined when nothing is focused", () => {
    expect(harness().source.current()).toBeUndefined();
  });

  it("3.3a current() wraps the active native editor with its uri and a 1-based line", () => {
    const { source } = harness(nativeEditor("/p/main.tex", 4));
    expect(source.current()?.uri.toString()).toBe(vscode.Uri.file("/p/main.tex").toString());
    expect(source.current()?.line()).toBe(5);
  });

  it("3.3a the native line follows the cursor", () => {
    const editor = nativeEditor("/p/main.tex", 0);
    const { source } = harness(editor);
    const view = source.current();
    editor.selection = new vscode.Selection(new vscode.Position(9, 0), new vscode.Position(9, 0));
    expect(view?.line()).toBe(10);
  });

  it("3.3a reveal on a native view centres the 1-based line through revealRange", () => {
    const editor = nativeEditor("/p/main.tex", 0);
    const { source } = harness(editor);
    source.current()?.reveal(12);
    expect(editor.revealRange).toHaveBeenCalledTimes(1);
    const [range, revealType] = editor.revealRange.mock.calls[0] as unknown as [vscode.Range, number];
    expect(range.start.line).toBe(11);
    expect(revealType).toBe(vscode.TextEditorRevealType.InCenter);
  });

  it("3.3a current() is the LabShelf view while it is focused", () => {
    const { source } = harness(nativeEditor("/p/other.tex", 0));
    const focused = new vscode.EventEmitter<boolean>();
    const view = labshelfView("/p/main.tex", 7);
    source.register(view, focused.event);
    focused.fire(true);
    expect(source.current()).toBe(view);
    expect(source.current()?.line()).toBe(7);
  });

  it("3.3a current() is the native editor after focusing it", () => {
    const { source, focusNative } = harness();
    const focused = new vscode.EventEmitter<boolean>();
    source.register(labshelfView("/p/main.tex"), focused.event);
    focused.fire(true);
    focused.fire(false);
    focusNative(nativeEditor("/p/other.tex", 2));
    expect(source.current()?.uri.toString()).toBe(vscode.Uri.file("/p/other.tex").toString());
    expect(source.current()?.line()).toBe(3);
  });

  it("3.3a focusing the LabShelf view again takes current() back from the native editor", () => {
    const { source, focusNative } = harness(nativeEditor("/p/other.tex", 0));
    const focused = new vscode.EventEmitter<boolean>();
    const view = labshelfView("/p/main.tex");
    source.register(view, focused.event);
    focusNative(undefined);
    focused.fire(true);
    expect(source.current()).toBe(view);
  });

  it("3.3a a webview of another kind taking focus does not clear current()", () => {
    const { source, focusNative } = harness();
    const focused = new vscode.EventEmitter<boolean>();
    const view = labshelfView("/p/main.tex");
    source.register(view, focused.event);
    focused.fire(true);
    focused.fire(false);
    focusNative(undefined);
    expect(source.current()).toBe(view);
  });

  it("3.3a a native editor losing focus to a webview does not clear current()", () => {
    const editor = nativeEditor("/p/main.tex", 0);
    const { source, focusNative } = harness(editor);
    focusNative(undefined);
    expect(source.current()?.uri.toString()).toBe(vscode.Uri.file("/p/main.tex").toString());
  });

  it("3.3a onDidChange reports the LabShelf view when it gains focus", () => {
    const { source } = harness();
    const seen: Array<SourceView | undefined> = [];
    source.onDidChange((view) => seen.push(view));
    const focused = new vscode.EventEmitter<boolean>();
    const view = labshelfView("/p/main.tex");
    source.register(view, focused.event);
    focused.fire(true);
    expect(seen[seen.length - 1]).toBe(view);
  });

  it("3.3a onDidChange reports the native editor when it takes focus", () => {
    const { source, focusNative } = harness();
    const seen: Array<SourceView | undefined> = [];
    source.onDidChange((view) => seen.push(view));
    focusNative(nativeEditor("/p/other.tex", 0));
    expect(seen[seen.length - 1]?.uri.toString()).toBe(vscode.Uri.file("/p/other.tex").toString());
  });

  it("3.3a a disposed registration is no longer current", () => {
    const { source } = harness();
    const focused = new vscode.EventEmitter<boolean>();
    const view = labshelfView("/p/main.tex");
    const registration = source.register(view, focused.event);
    focused.fire(true);
    registration.dispose();
    expect(source.current()).toBeUndefined();
  });

  it("3.3b openFor finds an open LabShelf view for the uri even when it is not focused", () => {
    const { source } = harness(nativeEditor("/p/other.tex", 0));
    const view = labshelfView("/p/main.tex");
    source.register(view, new vscode.EventEmitter<boolean>().event);
    expect(source.openFor(vscode.Uri.file("/p/main.tex"))).toBe(view);
  });

  it("3.3b openFor returns the view whose reveal moves the open LabShelf editor", () => {
    const { source } = harness();
    const view = labshelfView("/p/main.tex");
    source.register(view, new vscode.EventEmitter<boolean>().event);
    source.openFor(vscode.Uri.file("/p/main.tex"))?.reveal(31);
    expect(view.reveal).toHaveBeenCalledWith(31);
  });

  it("3.3b openFor is undefined for a uri with no LabShelf view", () => {
    const { source } = harness();
    source.register(labshelfView("/p/main.tex"), new vscode.EventEmitter<boolean>().event);
    expect(source.openFor(vscode.Uri.file("/p/chapter.tex"))).toBeUndefined();
  });

  it("3.3b openFor is undefined once the view is disposed", () => {
    const { source } = harness();
    const registration = source.register(labshelfView("/p/main.tex"), new vscode.EventEmitter<boolean>().event);
    registration.dispose();
    expect(source.openFor(vscode.Uri.file("/p/main.tex"))).toBeUndefined();
  });
});
