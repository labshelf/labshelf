// Source talks and posters: recognition.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { detectSourceDeckKind } from "../../src/decks/sourceDecks.js";

describe("detectSourceDeckKind", () => {
  it("reads the labshelf marker first, in either comment syntax", () => {
    expect(detectSourceDeckKind("latex", "% labshelf: poster\n\\documentclass{beamer}")).toBe("poster");
    expect(detectSourceDeckKind("typst", "// labshelf: talk\n#set page(width: 10cm)")).toBe("talk");
  });

  it("knows beamer as a talk and poster classes and packages as posters", () => {
    expect(detectSourceDeckKind("latex", "\\documentclass[aspectratio=169]{beamer}")).toBe("talk");
    expect(detectSourceDeckKind("latex", "\\documentclass[25pt]{tikzposter}")).toBe("poster");
    expect(detectSourceDeckKind("latex", "\\documentclass{beamer}\n\\usepackage[size=a0]{beamerposter}")).toBe("poster");
    expect(detectSourceDeckKind("latex", "\\documentclass{article}")).toBeNull();
  });

  it("ignores a commented-out document class", () => {
    expect(detectSourceDeckKind("latex", "% \\documentclass{beamer}\n\\documentclass{article}")).toBeNull();
  });

  it("knows Typst slide and poster packages by their import", () => {
    expect(detectSourceDeckKind("typst", '#import "@preview/touying:0.5.2": *')).toBe("talk");
    expect(detectSourceDeckKind("typst", '#import "@preview/peace-of-posters:0.5.0" as pop')).toBe("poster");
    expect(detectSourceDeckKind("typst", '#import "@preview/cetz:0.3.0"')).toBeNull();
  });
});
