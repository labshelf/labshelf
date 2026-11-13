import * as vscode from "vscode";
import { createAutosave } from "../../src/localSync/autosave";
import { createAutosave as createAutosaveFromIndex } from "../../src/localSync";

interface FakeDocument {
  uri: vscode.Uri;
  isDirty: boolean;
  save: jest.Mock<Promise<boolean>, []>;
}

function fakeDocument(path: string, isDirty = true): FakeDocument {
  return { uri: vscode.Uri.file(path), isDirty, save: jest.fn(async () => true) };
}

function asDocument(document: FakeDocument): vscode.TextDocument {
  return document as unknown as vscode.TextDocument;
}

describe("5.3 The notes editor and the deck editor save their documents 300 ms after their last edit from the page (D6b), and the reader re-pushes a paper's notes when its notes.qmd document or file changes (D6d).", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("5.3d createAutosave saves a dirty document once, 300 ms after the last of several schedule calls", () => {
    const autosave = createAutosave();
    const document = fakeDocument("/p/notes.qmd");

    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(200);
    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(200);
    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(299);
    expect(document.save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(document.save).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    expect(document.save).toHaveBeenCalledTimes(1);
    autosave.dispose();
  });

  it("5.3d createAutosave does not save a clean document", () => {
    const autosave = createAutosave();
    const document = fakeDocument("/p/notes.qmd", false);

    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(1000);

    expect(document.save).not.toHaveBeenCalled();
    autosave.dispose();
  });

  it("5.3d createAutosave does not save a document that became clean before the timer fired", () => {
    const autosave = createAutosave();
    const document = fakeDocument("/p/notes.qmd");

    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(100);
    document.isDirty = false;
    jest.advanceTimersByTime(1000);

    expect(document.save).not.toHaveBeenCalled();
    autosave.dispose();
  });

  it("5.3d createAutosave dispose before the delay saves nothing", () => {
    const autosave = createAutosave();
    const document = fakeDocument("/p/notes.qmd");

    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(299);
    autosave.dispose();
    jest.advanceTimersByTime(5000);

    expect(document.save).not.toHaveBeenCalled();
  });

  it("5.3d createAutosave times documents independently and dispose cancels every pending one", () => {
    const autosave = createAutosave();
    const first = fakeDocument("/p/a.qmd");
    const second = fakeDocument("/p/b.qmd");

    autosave.schedule(asDocument(first));
    jest.advanceTimersByTime(200);
    autosave.schedule(asDocument(second));
    jest.advanceTimersByTime(100);
    expect(first.save).toHaveBeenCalledTimes(1);
    expect(second.save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(second.save).toHaveBeenCalledTimes(1);

    autosave.schedule(asDocument(first));
    autosave.schedule(asDocument(second));
    autosave.dispose();
    jest.advanceTimersByTime(5000);
    expect(first.save).toHaveBeenCalledTimes(1);
    expect(second.save).toHaveBeenCalledTimes(1);
  });

  it("5.3d createAutosave scheduling one document does not delay another document's timer", () => {
    const autosave = createAutosave();
    const first = fakeDocument("/p/a.qmd");
    const second = fakeDocument("/p/b.qmd");

    autosave.schedule(asDocument(first));
    jest.advanceTimersByTime(250);
    autosave.schedule(asDocument(second));
    jest.advanceTimersByTime(50);

    expect(first.save).toHaveBeenCalledTimes(1);
    autosave.dispose();
  });

  it("5.3d createAutosave saves again when the same document is scheduled after a save", () => {
    const autosave = createAutosave();
    const document = fakeDocument("/p/notes.qmd");

    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(300);
    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(300);

    expect(document.save).toHaveBeenCalledTimes(2);
    autosave.dispose();
  });

  it("5.3d createAutosave uses the delay it is given", () => {
    const autosave = createAutosave(50);
    const document = fakeDocument("/p/notes.qmd");

    autosave.schedule(asDocument(document));
    jest.advanceTimersByTime(49);
    expect(document.save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(document.save).toHaveBeenCalledTimes(1);
    autosave.dispose();
  });

  it("5.3d localSync index exports createAutosave", () => {
    expect(createAutosaveFromIndex).toBe(createAutosave);
  });

  // 5.3a and 5.3b are about the notes editor and the deck editor calling createAutosave after an applied page
  // edit. At this seam, what they promise is the debounce of the autosave they hold: one save, 300 ms after the
  // last edit, none after dispose; the wiring itself is covered by the provider and deckSync tests.
  it("5.3a a notes-editor style autosave saves its document once, 300 ms after the last of several page edits, and not when disposed first", () => {
    const document = fakeDocument("/p/notes.qmd");

    const kept = createAutosave();
    for (let edit = 0; edit < 4; edit++) {
      kept.schedule(asDocument(document));
      jest.advanceTimersByTime(100);
    }
    jest.advanceTimersByTime(199);
    expect(document.save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(document.save).toHaveBeenCalledTimes(1);

    const disposedFirst = createAutosave();
    disposedFirst.schedule(asDocument(document));
    jest.advanceTimersByTime(100);
    disposedFirst.dispose();
    jest.advanceTimersByTime(5000);
    expect(document.save).toHaveBeenCalledTimes(1);
    kept.dispose();
  });

  it("5.3b a deck-editor style autosave saves deck.html and theme.css 300 ms after the last page edit, each only if dirty", () => {
    const autosave = createAutosave();
    const deck = fakeDocument("/p/deck.html");
    const theme = fakeDocument("/p/theme.css");
    const untouchedTheme = fakeDocument("/p/other-theme.css", false);

    autosave.schedule(asDocument(deck));
    autosave.schedule(asDocument(theme));
    autosave.schedule(asDocument(untouchedTheme));
    jest.advanceTimersByTime(200);
    autosave.schedule(asDocument(deck));
    autosave.schedule(asDocument(theme));
    jest.advanceTimersByTime(299);
    expect(deck.save).not.toHaveBeenCalled();
    expect(theme.save).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(deck.save).toHaveBeenCalledTimes(1);
    expect(theme.save).toHaveBeenCalledTimes(1);
    expect(untouchedTheme.save).not.toHaveBeenCalled();
    autosave.dispose();
  });
});
