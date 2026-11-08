// resolveDroppedImage: a file-tree drop becomes a path relative to the deck's folder, or nothing.
import { resolveDroppedImage } from "../../../src/libraryUi/editorArea/deckWorkspaceTab";

const deck = { projectIds: ["p1", "folder"], folder: "talks", typst: false };

describe("resolveDroppedImage", () => {
  it("returns the path relative to the deck folder", () => {
    expect(resolveDroppedImage([{ projectId: "p1", path: "figures/plot.png" }], deck)).toBe("../figures/plot.png");
  });

  it("accepts either name of the open project", () => {
    expect(resolveDroppedImage([{ projectId: "folder", path: "talks/a.svg" }], deck)).toBe("a.svg");
  });

  it("refuses a file of another project", () => {
    expect(resolveDroppedImage([{ projectId: "other", path: "figures/plot.png" }], deck)).toBeUndefined();
  });

  it("refuses pdf for Typst but not for LaTeX", () => {
    const files = [{ projectId: "p1", path: "figures/plot.pdf" }];
    expect(resolveDroppedImage(files, { ...deck, typst: true })).toBeUndefined();
    expect(resolveDroppedImage(files, deck)).toBe("../figures/plot.pdf");
  });

  it("refuses non-images and paths that leave the project", () => {
    expect(resolveDroppedImage([{ projectId: "p1", path: "notes.txt" }], deck)).toBeUndefined();
    expect(resolveDroppedImage([{ projectId: "p1", path: "../x.png" }], deck)).toBeUndefined();
  });
});
