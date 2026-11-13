/** @jest-environment jsdom */
// Pins scaffoldDeckFromTemplate for HTML, LaTeX and Typst decks: the files written and the sizes chosen.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { scaffoldDeck } from "../../src/decks/deckProject.js";
import { type DeckSize } from "../../src/decks/deckSizes.js";
import { readPosterSettings } from "../../src/decks/posterSections.js";
import { scaffoldSourceDeck } from "../../src/decks/sourceDeckScaffold.js";
import { detectSourceDeckKind, sourceDeckMainFile } from "../../src/decks/sourceDecks.js";
import { POSTER_SECTION_TEMPLATES } from "../../src/decks/deckTemplates.js";
import { A0, A0_LANDSCAPE, FOREST, NAME, TALK_16_9, TALK_4_3, TITLE, choice, columnOf, count, fileText, files, htmlDeck, sectionChunks, sizeOfDeck, validate } from "./deckTemplatesHarness.js";

describe("scaffoldDeckFromTemplate: HTML", () => {
  it("5.1b writes deck.html then theme.css", () => {
    expect(files(choice("talk", "html", "blank")).map((f) => f.path)).toEqual(["deck.html", "theme.css"]);
  });

  it("5.1b makes a Blank talk equal to scaffoldDeck byte for byte", () => {
    const expected = scaffoldDeck("talk", NAME, TALK_16_9);
    expect(htmlDeck(choice("talk", "html", "blank"))).toEqual(expected);
  });

  it("5.1b makes a Generic poster equal to scaffoldDeck byte for byte", () => {
    expect(htmlDeck(choice("poster", "html", "generic"))).toEqual(scaffoldDeck("poster", NAME, A0));
  });

  it("5.1b keeps the scaffoldDeck equality at another size", () => {
    const size: DeckSize = { w: 48, h: 36, unit: "in" };
    expect(htmlDeck(choice("poster", "html", "generic", { size }))).toEqual(scaffoldDeck("poster", NAME, size));
  });

  it("5.1b adds three slides to a Generic talk, each with a heading, a text block and empty notes", () => {
    const { html } = htmlDeck(choice("talk", "html", "generic"));
    expect(count(html, "<section data-slide>")).toBe(4);
    expect(count(html, "<aside data-notes></aside>")).toBe(4);
    const ids = [...html.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(ids.length);
    const blank = htmlDeck(choice("talk", "html", "blank")).html;
    expect(count(blank, "<section data-slide>")).toBe(1);
  });

  it("5.1b gives Better Poster columns 1 2 1 in the Poster Settings, reflowed to the header fraction", () => {
    const { html, theme } = htmlDeck(choice("poster", "html", "better-poster"));
    const { width, height } = sizeOfDeck(html);
    const settings = readPosterSettings(theme, width, height);
    expect(settings.columns).toEqual([1, 2, 1]);
    expect(settings.headerHeight).toBeCloseTo(0.08 * height, 1);
    expect(settings.typeScale).toBe(readPosterSettings("", width, height).typeScale);
  });

  it("5.1b puts the Better Poster takeaway in column 1 without a heading, with one theme rule", () => {
    const { html, theme } = htmlDeck(choice("poster", "html", "better-poster"));
    const sections = sectionChunks(html);
    expect(sections).toHaveLength(7);
    expect(sections.map(columnOf)).toEqual([0, 0, 0, 1, 2, 2, 2]);
    const takeaways = sections.filter((chunk) => chunk.includes('<p class="poster-takeaway">'));
    expect(takeaways).toHaveLength(1);
    expect(columnOf(takeaways[0]!)).toBe(1);
    expect(takeaways[0]).not.toContain("<h2>");
    expect(takeaways[0]).toContain(POSTER_SECTION_TEMPLATES.find((s) => s.id === "main-finding")!.text);
    expect(html).not.toContain("data-weight");
    const rule = ".poster-takeaway { font-size: var(--poster-font-title, 96px); font-weight: 700; line-height: 1.15; }";
    expect(count(theme, rule)).toBe(1);
  });

  it("5.1b writes ordinary sections as h2 and paragraph and no takeaway rule for Generic", () => {
    const { html, theme } = htmlDeck(choice("poster", "html", "better-poster"));
    const methods = POSTER_SECTION_TEMPLATES.find((s) => s.id === "methods")!;
    expect(html).toContain(`<h2>${methods.title}</h2><p>${methods.text}</p>`);
    expect(theme).toContain(".poster-takeaway");
    expect(htmlDeck(choice("poster", "html", "generic")).theme).not.toContain("poster-takeaway");
  });

  it("5.1b gives Billboard columns 2 1, type scale 1.25 and a weighted takeaway", () => {
    const { html, theme } = htmlDeck(choice("poster", "html", "billboard"));
    const { width, height } = sizeOfDeck(html);
    const settings = readPosterSettings(theme, width, height);
    expect(settings.columns).toEqual([2, 1]);
    expect(settings.typeScale).toBe(1.25);
    expect(settings.headerHeight).toBeCloseTo(0.16 * height, 1);
    const sections = sectionChunks(html);
    expect(sections.map(columnOf)).toEqual([0, 0, 1, 1, 1]);
    expect(sections[0]).toContain('data-weight="2"');
    expect(sections[0]).toContain("poster-takeaway");
    expect(count(html, "data-weight")).toBe(1);
  });

  it.each([
    ["talk", "blank"], ["talk", "generic"], ["poster", "blank"], ["poster", "generic"], ["poster", "better-poster"], ["poster", "billboard"],
  ] as const)("5.1b passes validateDeck for the %s %s template", (kind, template) => {
    expect(validate(htmlDeck(choice(kind, "html", template)))).toEqual([]);
  });

  it("5.1b passes validateDeck for the poster templates in a landscape inch size and with a style", () => {
    const size: DeckSize = { w: 48, h: 36, unit: "in" };
    for (const template of ["blank", "better-poster", "billboard"]) {
      expect(validate(htmlDeck(choice("poster", "html", template, { size, style: FOREST })))).toEqual([]);
    }
  });
});

describe("scaffoldDeckFromTemplate: LaTeX and Typst", () => {
  it.each(["latex", "typst"] as const)("5.1c writes one %s main file", (format) => {
    const out = files(choice("talk", format, "generic", { size: TALK_16_9 }));
    expect(out.map((f) => f.path)).toEqual([sourceDeckMainFile(format)]);
  });

  it.each(["latex", "typst"] as const)("5.1c makes a %s Generic talk equal to scaffoldSourceDeck at 16:9", (format) => {
    expect(fileText(choice("talk", format, "generic", { size: TALK_16_9 }))).toBe(scaffoldSourceDeck(format, TITLE, { kind: "talk", aspect: "16:9" }));
  });

  it.each(["latex", "typst"] as const)("5.1c makes a %s Generic talk equal to scaffoldSourceDeck at 4:3", (format) => {
    expect(fileText(choice("talk", format, "generic", { size: TALK_4_3 }))).toBe(scaffoldSourceDeck(format, TITLE, { kind: "talk", aspect: "4:3" }));
  });

  it("5.1c makes a LaTeX Generic poster equal to scaffoldSourceDeck, portrait and landscape", () => {
    expect(fileText(choice("poster", "latex", "generic", { size: A0 }))).toBe(
      scaffoldSourceDeck("latex", TITLE, { kind: "poster", size: A0, paper: "a0", landscape: false }));
    expect(fileText(choice("poster", "latex", "generic", { size: A0_LANDSCAPE }))).toBe(
      scaffoldSourceDeck("latex", TITLE, { kind: "poster", size: A0_LANDSCAPE, paper: "a0", landscape: true }));
  });

  it("5.1c makes a Typst Generic poster equal to scaffoldSourceDeck", () => {
    expect(fileText(choice("poster", "typst", "generic", { size: A0 }))).toBe(scaffoldSourceDeck("typst", TITLE, { kind: "poster", size: A0 }));
    const inches: DeckSize = { w: 36, h: 48, unit: "in" };
    expect(fileText(choice("poster", "typst", "generic", { size: inches }))).toBe(scaffoldSourceDeck("typst", TITLE, { kind: "poster", size: inches }));
  });

  it("5.1c makes a Blank LaTeX talk with the title slide only", () => {
    const blank = fileText(choice("talk", "latex", "blank"));
    expect(blank).toContain("% labshelf: talk");
    expect(blank).toContain("\\documentclass[aspectratio=169]{beamer}");
    expect(blank).toContain(`\\title{${TITLE}}`);
    expect(count(blank, "\\begin{frame}")).toBe(1);
    expect(blank).toContain("\\titlepage");
    expect(detectSourceDeckKind("latex", blank)).toBe("talk");
  });

  it("5.1c makes a Blank Typst talk with the title slide only", () => {
    const blank = fileText(choice("talk", "typst", "blank"));
    expect(blank).toContain("// labshelf: talk");
    expect(blank).toContain(TITLE);
    expect(blank).not.toContain("== ");
    expect(detectSourceDeckKind("typst", blank)).toBe("talk");
  });

  it("5.1c gives a tikzposter Better Poster the columns 0.25, 0.5 and 0.25 with the sections in order", () => {
    const text = fileText(choice("poster", "latex", "better-poster"));
    expect(text).toContain("% labshelf: poster");
    expect(text).toContain("\\begin{columns}");
    const columns = [...text.matchAll(/\\column\{([^}]+)\}/g)].map((m) => m[1]);
    expect(columns).toEqual(["0.25", "0.5", "0.25"]);
    const order = ["Introduction", "Methods", "Results"].map((title) => text.indexOf(`\\block{${title}}`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.indexOf("\\block{Introduction}")).toBeGreaterThan(text.indexOf("\\column{0.25}"));
    expect(text).toContain("\\block{}{\\Huge ");
    expect(text).toContain(POSTER_SECTION_TEMPLATES.find((s) => s.id === "main-finding")!.text);
    expect(detectSourceDeckKind("latex", text)).toBe("poster");
  });

  it("5.1c gives a tikzposter Billboard the columns 0.67 and 0.33", () => {
    const columns = [...fileText(choice("poster", "latex", "billboard")).matchAll(/\\column\{([^}]+)\}/g)].map((m) => m[1]);
    expect(columns).toEqual(["0.67", "0.33"]);
  });

  it("5.1c gives a Typst Better Poster a grid of columns 1fr 2fr 1fr with the sections as headings", () => {
    const text = fileText(choice("poster", "typst", "better-poster"));
    expect(text).toContain("// labshelf: poster");
    expect(text).toContain("#grid(columns: (1fr, 2fr, 1fr), gutter: 3cm,");
    expect(text).toContain("= Introduction");
    expect(text).toContain("= Methods");
    expect(text).toContain('#text(size: 72pt, weight: "bold")[');
    expect(text).toContain(POSTER_SECTION_TEMPLATES.find((s) => s.id === "main-finding")!.text);
    expect(detectSourceDeckKind("typst", text)).toBe("poster");
  });

  it("5.1c gives a Typst Billboard columns 2fr 1fr and a base text size multiplied by its type scale", () => {
    const text = fileText(choice("poster", "typst", "billboard"));
    expect(text).toContain("columns: (2fr, 1fr)");
    expect(text).toContain("#set text(size: 40pt)");
  });

  it("5.1c keeps the Typst base text size of the other posters", () => {
    expect(fileText(choice("poster", "typst", "better-poster"))).toContain("#set text(size: 32pt)");
  });

  it("5.1c makes a Blank poster with one section in every source format", () => {
    const latex = fileText(choice("poster", "latex", "blank"));
    expect(count(latex, "\\column{")).toBe(1);
    expect(latex).toContain("\\column{1}");
    expect(count(latex, "\\block{")).toBe(1);
    const typst = fileText(choice("poster", "typst", "blank"));
    expect(typst).toMatch(/columns: \(1fr,?\)/);
    expect(typst).toContain("= Introduction");
  });
});

