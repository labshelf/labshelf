// Source talks and posters: recognition, listing in a project, and which slide each PDF page shows.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectSourceDeckKind, listSourceDecks, mapPagesToSlides } from "../../src/decks/sourceDecks.js";
import { nodeFileReads } from "../../src/writing/project/node/projectReads.js";

const temps: string[] = [];

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-source-decks-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

afterAll(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

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

describe("listSourceDecks", () => {
  it("lists a deck main file and talk or poster folders holding the format's main file, skipping HTML decks", async () => {
    const root = makeProject({
      "main.tex": "\\documentclass{beamer}",
      "talks/defense/main.tex": "\\documentclass{beamer}",
      "talks/visual/deck.html": "<html></html>",
      "talks/visual/main.tex": "\\documentclass{beamer}",
      "posters/a0/main.tex": "\\documentclass{tikzposter}",
      "posters/typst-one/main.typ": "// labshelf: poster",
    });
    const decks = await listSourceDecks(nodeFileReads, root, { main: "main.tex", format: "latex" });
    expect(decks).toEqual([
      { kind: "talk", name: "main.tex", folder: "", file: "main.tex", format: "latex" },
      { kind: "talk", name: "defense", folder: "talks/defense", file: "talks/defense/main.tex", format: "latex" },
      { kind: "poster", name: "a0", folder: "posters/a0", file: "posters/a0/main.tex", format: "latex" },
    ]);
  });

  it("does not list an article main file", async () => {
    const root = makeProject({ "main.tex": "\\documentclass{article}" });
    expect(await listSourceDecks(nodeFileReads, root, { main: "main.tex", format: "latex" })).toEqual([]);
  });
});

describe("mapPagesToSlides", () => {
  it("maps overlay pages to their frame through numeric page labels", () => {
    expect(mapPagesToSlides(["1", "2", "2", "3"], 4, 3)).toEqual([0, 1, 1, 2]);
  });

  it("maps one page to one slide when the counts match and labels do not help", () => {
    expect(mapPagesToSlides(null, 3, 3)).toEqual([0, 1, 2]);
    expect(mapPagesToSlides(["i", "ii", "iii"], 3, 3)).toEqual([0, 1, 2]);
  });

  it("gives null when pages cannot be placed", () => {
    expect(mapPagesToSlides(null, 5, 3)).toBeNull();
    expect(mapPagesToSlides(["1", "3", "2"], 3, 2)).toBeNull();
  });
});
