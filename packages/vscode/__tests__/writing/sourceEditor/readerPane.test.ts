// Tests the inline preview's messages between the LabShelf editor page and its host, and which sources are articles.
import { isArticleSource, isReaderEnvelope, isReaderPaneMessage, readerPaneBoot, readerPaneMount, readerPaneSetShown, readerPaneShown, wrapReaderMessage } from "../../../src/writing/sourceEditor/readerPane";

describe("reader pane protocol", () => {
  it("recognises the reader envelope only with a message inside", () => {
    expect(isReaderEnvelope(wrapReaderMessage({ type: "reloadDocument" } as never))).toBe(true);
    expect(isReaderEnvelope({ channel: "reader" })).toBe(false);
    expect(isReaderEnvelope({ channel: "readerPane", type: "mount" })).toBe(false);
    expect(isReaderEnvelope({ type: "ready" })).toBe(false);
    expect(isReaderEnvelope(null)).toBe(false);
  });

  it("recognises the pane's control messages in both directions", () => {
    expect(isReaderPaneMessage(readerPaneMount())).toBe(true);
    expect(isReaderPaneMessage(readerPaneShown(false))).toBe(true);
    expect(isReaderPaneMessage(readerPaneSetShown(true))).toBe(true);
    expect(isReaderPaneMessage(readerPaneBoot({} as never, ""))).toBe(true);
    expect(isReaderPaneMessage({ channel: "readerPane", type: "shown" })).toBe(false);
    expect(isReaderPaneMessage({ channel: "readerPane", type: "boot", boot: {} })).toBe(false);
    expect(isReaderPaneMessage({ channel: "readerPane", type: "other" })).toBe(false);
    expect(isReaderPaneMessage(wrapReaderMessage({ type: "reloadDocument" } as never))).toBe(false);
  });

  it("takes LaTeX and Typst sources that are no talk or poster as articles", () => {
    expect(isArticleSource("/p/main.tex", "\\documentclass{article}\n\\begin{document}\\end{document}")).toBe(true);
    expect(isArticleSource("/p/main.typ", "= Title\n")).toBe(true);
    expect(isArticleSource("/p/talk.tex", "\\documentclass{beamer}\n\\begin{document}\\end{document}")).toBe(false);
    expect(isArticleSource("/p/notes.md", "# Notes")).toBe(false);
  });
});
