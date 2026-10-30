/** @jest-environment jsdom */
import { ViewModes } from "../../../src/reader/dom/appearance";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";

function setup() {
  const post = jest.fn();
  const pdfViewer = { scrollMode: 0, spreadMode: 0 };
  const viewerLib = { ScrollMode: { VERTICAL: 0, HORIZONTAL: 1, WRAPPED: 2 }, SpreadMode: { NONE: 0, ODD: 1, EVEN: 2 } };
  const ctx = { host: { post }, pdfViewer, viewerLib } as unknown as ReaderContext;
  return { modes: new ViewModes(ctx), post, pdfViewer };
}

describe("ViewModes", () => {
  it("applies a picked scroll mode to pdf.js and has the host remember it", () => {
    const { modes, post, pdfViewer } = setup();
    modes.set({ scroll: "horizontal" });
    expect(pdfViewer.scrollMode).toBe(1);
    expect(post).toHaveBeenCalledWith({ command: "setViewMode", scroll: "horizontal", spread: "none" });
  });

  it("restores a stored view without posting it, and ignores a repeat pick", () => {
    const { modes, post, pdfViewer } = setup();
    modes.restore({ scroll: "wrapped", spread: "even" });
    modes.set({ spread: "even" });
    expect([pdfViewer.scrollMode, pdfViewer.spreadMode]).toEqual([2, 2]);
    expect(post).not.toHaveBeenCalled();
  });
});
