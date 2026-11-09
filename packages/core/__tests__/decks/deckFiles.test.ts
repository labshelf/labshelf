// Talks and posters found by their content anywhere in a project: HTML decks by data-deck, LaTeX and Typst sources by class, package or marker.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectHtmlDeckKind, listProjectDeckFiles, readDeckFileKind } from "../../src/decks/deckFiles.js";
import { nodeFileReads } from "../../src/writing/project/node/projectReads.js";

const temps: string[] = [];

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-deck-files-"));
  temps.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

afterAll(() => { for (const root of temps) fs.rmSync(root, { recursive: true, force: true }); });

describe("detectHtmlDeckKind", () => {
  it("reads the kind from the html element's data-deck", () => {
    expect(detectHtmlDeckKind('<!doctype html>\n<html lang="en" data-deck="talk" data-deck-version="1">')).toBe("talk");
    expect(detectHtmlDeckKind("<HTML data-deck='poster'>")).toBe("poster");
  });

  it("is null for a page without it or with it on another element", () => {
    expect(detectHtmlDeckKind("<html><body><div data-deck=\"talk\"></div></body></html>")).toBeNull();
    expect(detectHtmlDeckKind("<html lang=\"en\">")).toBeNull();
  });
});

describe("readDeckFileKind", () => {
  it("reads HTML, LaTeX and Typst files by their content and ignores other files", () => {
    expect(readDeckFileKind("slides/index.html", '<html data-deck="talk">')).toBe("talk");
    expect(readDeckFileKind("defesa.tex", "\\documentclass{beamer}")).toBe("talk");
    expect(readDeckFileKind("poster.typ", '#import "@preview/peace-of-posters:0.5.0": *')).toBe("poster");
    expect(readDeckFileKind("paper.tex", "\\documentclass{article}")).toBeUndefined();
    expect(readDeckFileKind("notes.md", '<html data-deck="talk">')).toBeUndefined();
  });
});

describe("listProjectDeckFiles", () => {
  it("finds talks and posters in any folder and leaves other files out", async () => {
    const root = makeProject({
      "main.tex": "\\documentclass{article}",
      "slides/defesa.tex": "\\documentclass{beamer}",
      "site/deck.html": '<html data-deck="poster">',
      "site/index.html": "<html></html>",
      "talks/a/deck.html": '<html data-deck="talk">',
    });
    expect(await listProjectDeckFiles(nodeFileReads, root)).toEqual([
      { path: "site/deck.html", kind: "poster", format: "html" },
      { path: "slides/defesa.tex", kind: "talk", format: "latex" },
      { path: "talks/a/deck.html", kind: "talk", format: "html" },
    ]);
  });
});
