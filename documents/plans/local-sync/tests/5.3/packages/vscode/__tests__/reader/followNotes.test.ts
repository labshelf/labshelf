import * as vscode from "vscode";
import { followNotesFile } from "../../src/reader/followNotes";

const NOTES_PATH = "/library/papers/some-paper/notes.qmd";

interface FakeWatcher {
  pattern: { base: unknown; pattern: string };
  dispose: jest.Mock;
  _fire(kind: "create" | "change" | "delete", uri: vscode.Uri): void;
}

const mockApi = vscode as unknown as {
  _fileWatchers: FakeWatcher[];
  workspace: { _fireTextDocumentChange(event: unknown): void };
};

function textChange(path: string, contentChanges: unknown[] = [{ text: "x" }]) {
  return { document: { uri: vscode.Uri.file(path) }, contentChanges, reason: undefined };
}

function lastWatcher(): FakeWatcher {
  const watcher = mockApi._fileWatchers[mockApi._fileWatchers.length - 1];
  if (!watcher) throw new Error("no file watcher was created");
  return watcher;
}

describe("5.3 The notes editor and the deck editor save their documents 300 ms after their last edit from the page (D6b), and the reader re-pushes a paper's notes when its notes.qmd document or file changes (D6d).", () => {
  let followers: vscode.Disposable[];

  function follow(onChange: () => void, path = NOTES_PATH): vscode.Disposable {
    const disposable = followNotesFile(vscode.Uri.file(path), onChange);
    followers.push(disposable);
    return disposable;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockApi._fileWatchers.length = 0;
    followers = [];
  });

  afterEach(() => {
    for (const follower of followers) follower.dispose();
    jest.useRealTimers();
  });

  it("5.3c followNotesFile calls onChange once, 100 ms after a burst of changes of the notes document", () => {
    const onChange = jest.fn();
    follow(onChange);

    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(60);
    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(60);
    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(99);
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("5.3c followNotesFile calls onChange once, 100 ms after a burst of file changes, creations and deletions of the notes file", () => {
    const onChange = jest.fn();
    follow(onChange);
    const watcher = lastWatcher();
    const uri = vscode.Uri.file(NOTES_PATH);

    watcher._fire("create", uri);
    jest.advanceTimersByTime(40);
    watcher._fire("change", uri);
    jest.advanceTimersByTime(40);
    watcher._fire("delete", uri);
    jest.advanceTimersByTime(99);
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("5.3c followNotesFile treats a document change and a file change in one burst as a single onChange", () => {
    const onChange = jest.fn();
    follow(onChange);

    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(50);
    lastWatcher()._fire("change", vscode.Uri.file(NOTES_PATH));
    jest.advanceTimersByTime(99);
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("5.3c followNotesFile calls onChange again for a later change after the first call", () => {
    const onChange = jest.fn();
    follow(onChange);

    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(100);
    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(100);

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("5.3c followNotesFile ignores changes of other documents", () => {
    const onChange = jest.fn();
    follow(onChange);

    mockApi.workspace._fireTextDocumentChange(textChange("/library/papers/other-paper/notes.qmd"));
    mockApi.workspace._fireTextDocumentChange(textChange("/library/papers/some-paper/paper.pdf"));
    jest.advanceTimersByTime(5000);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3c followNotesFile ignores document events with no content changes", () => {
    const onChange = jest.fn();
    follow(onChange);

    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH, []));
    jest.advanceTimersByTime(5000);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("5.3c followNotesFile watches the notes file by its folder and file name", () => {
    follow(jest.fn());

    const watcher = lastWatcher();
    expect(watcher.pattern.pattern).toBe("notes.qmd");
    const base = watcher.pattern.base as { fsPath?: string; path?: string } | string;
    const basePath = typeof base === "string" ? base : (base.fsPath ?? base.path);
    expect(basePath).toBe("/library/papers/some-paper");
  });

  it("5.3c followNotesFile after dispose nothing calls onChange", () => {
    const onChange = jest.fn();
    const disposable = follow(onChange);
    const watcher = lastWatcher();

    disposable.dispose();
    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    watcher._fire("change", vscode.Uri.file(NOTES_PATH));
    watcher._fire("create", vscode.Uri.file(NOTES_PATH));
    watcher._fire("delete", vscode.Uri.file(NOTES_PATH));
    jest.advanceTimersByTime(5000);

    expect(onChange).not.toHaveBeenCalled();
    expect(watcher.dispose).toHaveBeenCalled();
  });

  it("5.3c followNotesFile dispose cancels a pending call", () => {
    const onChange = jest.fn();
    const disposable = follow(onChange);

    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(50);
    disposable.dispose();
    jest.advanceTimersByTime(5000);

    expect(onChange).not.toHaveBeenCalled();
  });

  // The panel side of A6 (ReaderPanel._subscribe passing () => void this.controller.refreshNotes() when
  // source.notes is set, and not for a preview) needs the panel test; here only the part reachable through
  // followNotesFile is checked: an edit in the notes editor reaches the callback the panel hands over.
  it("A6 followNotesFile turns an edit of notes.qmd in the notes editor into one callback, the way the reader's refreshNotes is reached", () => {
    const refreshNotes = jest.fn();
    follow(() => void refreshNotes());

    mockApi.workspace._fireTextDocumentChange(textChange(NOTES_PATH));
    jest.advanceTimersByTime(100);

    expect(refreshNotes).toHaveBeenCalledTimes(1);
  });
});
