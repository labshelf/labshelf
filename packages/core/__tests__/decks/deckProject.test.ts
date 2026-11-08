// Hidden tests of spec 2.1 for deck names, deck paths, the deck folders of a project and the deck scaffold.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkDeckPath, deckRootOf, isDeckName, listDecks, scaffoldDeck } from "../../src/decks/deckProject.js";
import { formatDeckSize, listDeckSizePresets, type DeckSize } from "../../src/decks/deckSizes.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { nodeFileReads } from "../../src/writing/project/node/projectReads.js";

const temps: string[] = [];

function makeProject(files: Record<string, string>, folders: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-project-"));
  temps.push(root);
  for (const folder of folders) fs.mkdirSync(path.join(root, folder), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

afterEach(() => {
  while (temps.length > 0) fs.rmSync(temps.pop()!, { recursive: true, force: true });
});

const validate = (deck: { html: string; theme: string }) =>
  validateDeck(deck.html, { theme: deck.theme, files: new Set(["theme.css"]) });

describe("checkDeckPath", () => {
  it("2.1a accepts a talk folder itself with an empty inner", () => {
    expect(checkDeckPath("talks/intro")).toEqual({ kind: "talk", name: "intro", folder: "talks/intro", inner: "" });
  });

  it("2.1a accepts a poster folder itself with an empty inner", () => {
    expect(checkDeckPath("posters/a0-results")).toEqual({ kind: "poster", name: "a0-results", folder: "posters/a0-results", inner: "" });
  });

  it("2.1a accepts a file inside a talk and gives the rest as inner", () => {
    expect(checkDeckPath("talks/intro/deck.html")).toEqual({ kind: "talk", name: "intro", folder: "talks/intro", inner: "deck.html" });
  });

  it("2.1a accepts a nested file inside a poster", () => {
    expect(checkDeckPath("posters/p1/assets/fig/plot.png")).toEqual({ kind: "poster", name: "p1", folder: "posters/p1", inner: "assets/fig/plot.png" });
  });

  it("2.1a accepts a name of 64 characters and a name starting with a digit", () => {
    const long = `a${"b".repeat(63)}`;
    expect(checkDeckPath(`talks/${long}`)?.name).toBe(long);
    expect(checkDeckPath("talks/2024-conf")?.name).toBe("2024-conf");
  });

  it("2.1a refuses absolute paths", () => {
    expect(checkDeckPath("/talks/intro")).toBeNull();
    expect(checkDeckPath("/talks/intro/deck.html")).toBeNull();
  });

  it("2.1a refuses paths holding a .. segment", () => {
    expect(checkDeckPath("talks/../posters/x")).toBeNull();
    expect(checkDeckPath("talks/intro/../../secret")).toBeNull();
    expect(checkDeckPath("talks/intro/..")).toBeNull();
    expect(checkDeckPath("../talks/intro")).toBeNull();
  });

  it("2.1a refuses paths holding a . segment", () => {
    expect(checkDeckPath("./talks/intro")).toBeNull();
    expect(checkDeckPath("talks/./intro")).toBeNull();
    expect(checkDeckPath("talks/intro/./deck.html")).toBeNull();
  });

  it("2.1a refuses the empty path and paths with an empty segment", () => {
    expect(checkDeckPath("")).toBeNull();
    expect(checkDeckPath("talks//intro")).toBeNull();
    expect(checkDeckPath("talks/intro//deck.html")).toBeNull();
    expect(checkDeckPath("talks/intro/")).toBeNull();
  });

  it("2.1a refuses other roots and a bare root", () => {
    expect(checkDeckPath("decks/intro")).toBeNull();
    expect(checkDeckPath("talk/intro")).toBeNull();
    expect(checkDeckPath("Talks/intro")).toBeNull();
    expect(checkDeckPath("figures/talks/intro")).toBeNull();
    expect(checkDeckPath("talks")).toBeNull();
    expect(checkDeckPath("posters")).toBeNull();
  });

  it("2.1a refuses bad deck names", () => {
    expect(checkDeckPath("talks/Intro")).toBeNull();
    expect(checkDeckPath("talks/-intro")).toBeNull();
    expect(checkDeckPath("talks/my_talk")).toBeNull();
    expect(checkDeckPath("posters/my poster")).toBeNull();
    expect(checkDeckPath(`talks/a${"b".repeat(64)}`)).toBeNull();
  });

  it("2.1a refuses backslashes", () => {
    expect(checkDeckPath("talks\\intro")).toBeNull();
    expect(checkDeckPath("talks/intro\\deck.html")).toBeNull();
  });

  it("2.1a isDeckName follows ^[a-z0-9][a-z0-9-]{0,63}$", () => {
    expect(isDeckName("a")).toBe(true);
    expect(isDeckName("0")).toBe(true);
    expect(isDeckName("intro-2024")).toBe(true);
    expect(isDeckName(`a${"-".repeat(63)}`)).toBe(true);
    expect(isDeckName(`a${"b".repeat(64)}`)).toBe(false);
    expect(isDeckName("")).toBe(false);
    expect(isDeckName("-a")).toBe(false);
    expect(isDeckName("A")).toBe(false);
    expect(isDeckName("a.b")).toBe(false);
    expect(isDeckName("a/b")).toBe(false);
  });

  it("2.1a deckRootOf maps talk to talks and poster to posters", () => {
    expect(deckRootOf("talk")).toBe("talks");
    expect(deckRootOf("poster")).toBe("posters");
  });
});

describe("listDecks", () => {
  it("2.1b lists valid-name folders with a deck.html, talks before posters, sorted by name", async () => {
    const root = makeProject({
      "talks/zeta/deck.html": "<!doctype html>",
      "talks/alpha/deck.html": "<!doctype html>",
      "talks/alpha/theme.css": ":root {}",
      "posters/main/deck.html": "<!doctype html>",
      "posters/b-side/deck.html": "<!doctype html>",
      "main.tex": "\\documentclass{article}",
    });
    expect(await listDecks(nodeFileReads, root)).toEqual([
      { kind: "talk", name: "alpha", folder: "talks/alpha", file: "talks/alpha/deck.html", theme: "talks/alpha/theme.css" },
      { kind: "talk", name: "zeta", folder: "talks/zeta", file: "talks/zeta/deck.html", theme: "talks/zeta/theme.css" },
      { kind: "poster", name: "b-side", folder: "posters/b-side", file: "posters/b-side/deck.html", theme: "posters/b-side/theme.css" },
      { kind: "poster", name: "main", folder: "posters/main", file: "posters/main/deck.html", theme: "posters/main/theme.css" },
    ]);
  });

  it("2.1b skips folders with an invalid name", async () => {
    const root = makeProject({
      "talks/Bad/deck.html": "x",
      "talks/my_talk/deck.html": "x",
      "talks/-dash/deck.html": "x",
      "talks/.hidden/deck.html": "x",
      "talks/ok/deck.html": "x",
    });
    expect((await listDecks(nodeFileReads, root)).map((d) => d.name)).toEqual(["ok"]);
  });

  it("2.1b skips folders without a deck.html file and loose files in the roots", async () => {
    const root = makeProject({
      "talks/empty-theme/theme.css": ":root {}",
      "talks/nested/sub/deck.html": "x",
      "talks/deck.html": "x",
      "posters/loose.html": "x",
      "posters/real/deck.html": "x",
    }, ["talks/empty", "talks/dir-deck/deck.html"]);
    expect(await listDecks(nodeFileReads, root)).toEqual([
      { kind: "poster", name: "real", folder: "posters/real", file: "posters/real/deck.html", theme: "posters/real/theme.css" },
    ]);
  });

  it("2.1b does not list decks outside talks/ and posters/", async () => {
    const root = makeProject({ "decks/x/deck.html": "x", "talk/y/deck.html": "x", "sub/talks/z/deck.html": "x" });
    expect(await listDecks(nodeFileReads, root)).toEqual([]);
  });

  it("2.1b gives nothing for missing roots", async () => {
    const empty = makeProject({ "main.tex": "x" });
    expect(await listDecks(nodeFileReads, empty)).toEqual([]);
    const postersOnly = makeProject({ "posters/p/deck.html": "x" });
    expect((await listDecks(nodeFileReads, postersOnly)).map((d) => `${d.kind}:${d.name}`)).toEqual(["poster:p"]);
    const talksOnly = makeProject({ "talks/t/deck.html": "x" });
    expect((await listDecks(nodeFileReads, talksOnly)).map((d) => `${d.kind}:${d.name}`)).toEqual(["talk:t"]);
  });
});

describe("scaffoldDeck", () => {
  const htmlTag = (html: string): string => /<html\b[^>]*>/.exec(html)?.[0] ?? "";

  it("2.1c a default talk validates with no diagnostic", () => {
    const deck = scaffoldDeck("talk", "intro");
    expect(validate(deck)).toEqual([]);
  });

  it("2.1c a default talk is 1920x1080px with the name as title and h1 and empty notes", () => {
    const { html } = scaffoldDeck("talk", "intro");
    expect(html.trimStart().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    const tag = htmlTag(html);
    expect(tag).toMatch(/\blang="en"/);
    expect(tag).toMatch(/\bdata-deck="talk"/);
    expect(tag).toMatch(/\bdata-deck-version="1"/);
    expect(tag).toMatch(/\bdata-deck-size="1920x1080px"/);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toMatch(/<title>intro<\/title>/);
    expect(html).toMatch(/<link[^>]*data-deck-theme[^>]*>/);
    expect(html.match(/<section data-slide/g)).toHaveLength(1);
    expect(html).toMatch(/data-block="title"[^>]*>\s*<h1>intro<\/h1>/);
    expect(html).toContain("<aside data-notes></aside>");
  });

  it("2.1c a default poster validates with no diagnostic", () => {
    const deck = scaffoldDeck("poster", "results");
    expect(validate(deck)).toEqual([]);
  });

  it("2.1c a default poster is 841x1189mm with the name as h1 and no notes", () => {
    const { html } = scaffoldDeck("poster", "results");
    const tag = htmlTag(html);
    expect(tag).toMatch(/\bdata-deck="poster"/);
    expect(tag).toMatch(/\bdata-deck-size="841x1189mm"/);
    expect(html).toMatch(/<title>results<\/title>/);
    expect(html.match(/<section data-slide/g)).toHaveLength(1);
    expect(html).toMatch(/data-poster="header"[^>]*>\s*<h1>results<\/h1>/);
    expect(html).not.toContain("data-notes");
  });

  it.each(listDeckSizePresets("talk").map((p) => [p.id, p.size] as const))("2.1c the talk preset %s validates with its size", (_id, size) => {
    const deck = scaffoldDeck("talk", "t1", size);
    expect(validate(deck)).toEqual([]);
    expect(htmlTag(deck.html)).toContain(`data-deck-size="${formatDeckSize(size)}"`);
  });

  it.each(listDeckSizePresets("poster").map((p) => [p.id, p.size] as const))("2.1c the poster preset %s validates with its size", (_id, size) => {
    const deck = scaffoldDeck("poster", "p1", size);
    expect(validate(deck)).toEqual([]);
    expect(htmlTag(deck.html)).toContain(`data-deck-size="${formatDeckSize(size)}"`);
  });

  it("2.1c custom allowed sizes, including the smallest canvases, validate", () => {
    const sizes: Array<["talk" | "poster", DeckSize]> = [
      ["talk", { w: 320, h: 320, unit: "px" }],
      ["talk", { w: 7680, h: 4320, unit: "px" }],
      ["poster", { w: 100, h: 100, unit: "mm" }],
      ["poster", { w: 100.5, h: 200, unit: "mm" }],
      ["poster", { w: 4, h: 4, unit: "in" }],
    ];
    for (const [kind, size] of sizes) {
      const deck = scaffoldDeck(kind, "custom", size);
      expect(validate(deck)).toEqual([]);
      expect(htmlTag(deck.html)).toContain(`data-deck-size="${formatDeckSize(size)}"`);
    }
  });

  it("2.1c the theme has a :root rule with the four deck properties, then body and h1 rules using them", () => {
    for (const kind of ["talk", "poster"] as const) {
      const { theme } = scaffoldDeck(kind, "x");
      const rootRule = /:root\s*\{([^}]*)\}/.exec(theme);
      expect(rootRule).not.toBeNull();
      for (const name of ["--deck-bg", "--deck-fg", "--deck-accent", "--deck-font"]) expect(rootRule![1]).toMatch(new RegExp(`${name}\\s*:`));
      const bodyAt = theme.search(/(^|[\s}])body\s*\{/);
      const h1At = theme.search(/(^|[\s}])h1\s*\{/);
      expect(bodyAt).toBeGreaterThan(rootRule!.index);
      expect(h1At).toBeGreaterThan(rootRule!.index);
      expect(/(?:^|[\s}])body\s*\{([^}]*)\}/.exec(theme)![1]).toMatch(/var\(--deck-/);
      expect(/(?:^|[\s}])h1\s*\{([^}]*)\}/.exec(theme)![1]).toMatch(/var\(--deck-/);
    }
  });

  it("2.1c a size not allowed for the kind throws RangeError", () => {
    expect(() => scaffoldDeck("talk", "t", { w: 841, h: 1189, unit: "mm" })).toThrow(RangeError);
    expect(() => scaffoldDeck("talk", "t", { w: 100, h: 100, unit: "px" })).toThrow(RangeError);
    expect(() => scaffoldDeck("poster", "p", { w: 1920, h: 1080, unit: "px" })).toThrow(RangeError);
    expect(() => scaffoldDeck("poster", "p", { w: 3000, h: 1000, unit: "mm" })).toThrow(RangeError);
  });

  it("2.1c a bad name throws RangeError", () => {
    expect(() => scaffoldDeck("talk", "Bad")).toThrow(RangeError);
    expect(() => scaffoldDeck("talk", "")).toThrow(RangeError);
    expect(() => scaffoldDeck("poster", "-x")).toThrow(RangeError);
    expect(() => scaffoldDeck("poster", "a/b")).toThrow(RangeError);
  });
});
