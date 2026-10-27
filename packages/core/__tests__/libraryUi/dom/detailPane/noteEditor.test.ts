/**
 * @jest-environment jsdom
 */
// Tests that the note editor saves a draft once after typing pauses, and at once on flush.
import { createNoteEditor } from "../../../../src/libraryUi/dom/detailPane/noteEditor";

function setup() {
  const post = jest.fn();
  const applyNote = jest.fn();
  const ctx = { store: { applyNote }, transport: { post } };
  const editor = createNoteEditor(ctx as never, document.createElement("div"));
  return { editor, post };
}

describe("note editor autosave", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("posts the latest draft once after rapid changes", () => {
    const { editor, post } = setup();
    for (const text of ["a", "ab", "abc"]) { editor.changed("p1", text); }
    expect(post).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "paper.setNote", id: "p1", note: "abc" });
  });

  it("does not post a second time after a flush", () => {
    const { editor, post } = setup();
    editor.changed("p1", "x");
    editor.flush();
    jest.advanceTimersByTime(5000);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
