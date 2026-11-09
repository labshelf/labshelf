/** @jest-environment jsdom */
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { scaffoldDeck, isDeckName } from "../../src/decks/deckProject.js";
import { readThemeStyle } from "../../src/decks/deckStyleCss.js";
import { readSourceDeckStyle } from "../../src/decks/deckStyleSource.js";
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import { DECK_STYLE_PRESETS } from "../../src/decks/deckStylePresets.js";
import { listDeckSizePresets, type DeckKind, type DeckSize } from "../../src/decks/deckSizes.js";
import { readPosterSettings } from "../../src/decks/posterSections.js";
import { scaffoldSourceDeck } from "../../src/decks/sourceDeckScaffold.js";
import { detectSourceDeckKind, sourceDeckMainFile } from "../../src/decks/sourceDecks.js";
import * as decks from "../../src/decks/index.js";
import { POSTER_SECTION_TEMPLATES, listDeckTemplates, listTemplateSizes, parseDeckTemplateChoice, type DeckTemplateFormat } from "../../src/decks/deckTemplates.js";
import { A0, A0_LANDSCAPE, A3, FORMATS, FOREST, KIT_STYLE, NAME, TALK_16_9, TALK_4_3, TITLE, choice, columnOf, count, fileText, files, htmlDeck, sectionChunks, sizeOfDeck, validate } from "./deckTemplatesHarness.js";

describe("POSTER_SECTION_TEMPLATES", () => {
  it("5.1a lists the poster section templates in order with title case titles and one sentence of text", () => {
    expect(POSTER_SECTION_TEMPLATES.map((s) => s.id)).toEqual([
      "introduction", "methods", "results", "conclusion", "references", "acknowledgements", "contact", "main-finding", "key-figure",
    ]);
    const byId = Object.fromEntries(POSTER_SECTION_TEMPLATES.map((s) => [s.id, s]));
    expect(byId["main-finding"]!.title).toBe("Main finding");
    expect(byId["key-figure"]!.title).toBe("Key figure");
    expect(byId["introduction"]!.title).toBe("Introduction");
    for (const section of POSTER_SECTION_TEMPLATES) expect(section.text.trim()).not.toBe("");
  });
});

describe("listDeckTemplates", () => {
  it.each(FORMATS)("5.1a gives blank then generic for talks in %s", (format) => {
    expect(listDeckTemplates("talk", format).map((t) => t.id)).toEqual(["blank", "generic"]);
  });

  it.each(FORMATS)("5.1a gives blank, generic, better-poster and billboard for posters in %s", (format) => {
    expect(listDeckTemplates("poster", format).map((t) => t.id)).toEqual(["blank", "generic", "better-poster", "billboard"]);
  });

  it("5.1a names the first template Blank and gives every template an English description", () => {
    for (const kind of ["talk", "poster"] as const) {
      const templates = listDeckTemplates(kind, "html");
      expect(templates[0]!.name).toBe("Blank");
      for (const template of templates) {
        expect(template.kind).toBe(kind);
        expect(template.name.trim()).not.toBe("");
        expect(template.description.trim()).not.toBe("");
        expect(template.formats).toEqual(expect.arrayContaining(["html"]));
      }
    }
    expect(listDeckTemplates("poster", "html").map((t) => t.name)).toEqual(["Blank", "Generic", "Better Poster", "Billboard"]);
  });

  it("5.1a gives talk templates no poster layout and every poster template one", () => {
    for (const template of listDeckTemplates("talk", "html")) expect(template.poster).toBeUndefined();
    for (const template of listDeckTemplates("poster", "html")) expect(template.poster).toBeDefined();
  });

  it("5.1a gives the Better Poster layout: columns 1 2 1 with the main finding as takeaway in the wide column", () => {
    const layout = listDeckTemplates("poster", "html").find((t) => t.id === "better-poster")!.poster!;
    expect(layout.columns).toEqual([1, 2, 1]);
    expect(layout.headerHeight).toBe(0.08);
    expect(layout.sections.map((s) => [s.section, s.column])).toEqual([
      ["introduction", 0], ["methods", 0], ["results", 0], ["main-finding", 1], ["key-figure", 2], ["references", 2], ["contact", 2],
    ]);
    expect(layout.sections.filter((s) => s.takeaway === true).map((s) => s.section)).toEqual(["main-finding"]);
  });

  it("5.1a gives the Billboard layout: a large header and type, columns 2 1", () => {
    const layout = listDeckTemplates("poster", "html").find((t) => t.id === "billboard")!.poster!;
    expect(layout.columns).toEqual([2, 1]);
    expect(layout.headerHeight).toBe(0.16);
    expect(layout.typeScale).toBe(1.25);
    expect(layout.sections.map((s) => [s.section, s.column])).toEqual([
      ["main-finding", 0], ["key-figure", 0], ["methods", 1], ["results", 1], ["contact", 1],
    ]);
    expect(layout.sections[0]).toMatchObject({ weight: 2, takeaway: true });
  });

  it("5.1a gives the Generic layout of today's poster and the Blank layout of one full-width section", () => {
    const templates = listDeckTemplates("poster", "html");
    const generic = templates.find((t) => t.id === "generic")!.poster!;
    expect(generic.columns).toEqual([1, 1, 1]);
    expect(generic.headerHeight).toBe(0.12);
    expect(generic.sections.map((s) => [s.section, s.column])).toEqual([["introduction", 0], ["methods", 1], ["results", 2]]);
    const blank = templates.find((t) => t.id === "blank")!.poster!;
    expect(blank.columns).toEqual([1]);
    expect(blank.headerHeight).toBe(0.12);
    expect(blank.sections.map((s) => [s.section, s.column])).toEqual([["introduction", 0]]);
  });

  it("5.1a only refers to section templates that exist", () => {
    const known = new Set(POSTER_SECTION_TEMPLATES.map((s) => s.id));
    for (const template of listDeckTemplates("poster", "html")) for (const section of template.poster!.sections) expect(known.has(section.section)).toBe(true);
  });

  it("5.1a returns fresh copies and gives [] for an unknown kind or format", () => {
    const first = listDeckTemplates("poster", "html");
    first.pop();
    first[0]!.name = "Changed";
    first[1]!.poster!.columns.push(9);
    const second = listDeckTemplates("poster", "html");
    expect(second).toHaveLength(4);
    expect(second[0]!.name).toBe("Blank");
    expect(second[1]!.poster!.columns).toEqual([1, 1, 1]);
    expect(listDeckTemplates("banner" as DeckKind, "html")).toEqual([]);
    expect(listDeckTemplates("talk", "word" as DeckTemplateFormat)).toEqual([]);
  });

  it("5.1a is exported from the decks barrel", () => {
    expect(decks.listDeckTemplates).toBe(listDeckTemplates);
    expect(decks.DECK_STYLE_PRESETS).toBe(DECK_STYLE_PRESETS);
  });
});

describe("listTemplateSizes", () => {
  it("5.1e gives html the size presets of the kind", () => {
    expect(listTemplateSizes("talk", "html")).toEqual(listDeckSizePresets("talk"));
    expect(listTemplateSizes("poster", "html")).toEqual(listDeckSizePresets("poster"));
  });

  it.each(["latex", "typst"] as const)("5.1e gives %s talks the 16:9 and 4:3 presets", (format) => {
    expect(listTemplateSizes("talk", format).map((p) => p.id)).toEqual(["talk-16-9", "talk-4-3"]);
  });

  it("5.1e gives LaTeX posters the six A0 to A2 presets and Typst posters every poster preset", () => {
    expect(listTemplateSizes("poster", "latex").map((p) => p.id)).toEqual([
      "a0-portrait", "a0-landscape", "a1-portrait", "a1-landscape", "a2-portrait", "a2-landscape",
    ]);
    expect(listTemplateSizes("poster", "typst")).toEqual(listDeckSizePresets("poster"));
  });
});

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

describe("scaffoldDeckFromTemplate: style", () => {
  it("5.1d writes the palette into theme.css as the labshelf:style block", () => {
    const { theme } = htmlDeck(choice("talk", "html", "generic", { style: FOREST }));
    expect(theme).toContain("/* labshelf:style */");
    expect(theme).toContain("/* labshelf:style end */");
    expect(readThemeStyle(theme).style).toMatchObject({ primary: FOREST.primary, accent: FOREST.accent, background: FOREST.background });
  });

  it("5.1d leaves deck.html alone and adds no style block when the style is null", () => {
    const styled = htmlDeck(choice("poster", "html", "generic", { style: FOREST }));
    const plain = htmlDeck(choice("poster", "html", "generic"));
    expect(plain.theme).not.toContain("labshelf:style");
    expect(styled.html).toBe(plain.html);
  });

  it.each([["latex", "main.tex"], ["typst", "main.typ"]] as const)("5.1d writes the palette into %s as the labshelf:style block of %s", (format, main) => {
    for (const kind of ["talk", "poster"] as const) {
      const out = files(choice(kind, format, "blank", { style: FOREST }));
      expect(out.map((f) => f.path)).toEqual([main]);
      const text = out[0]!.text;
      expect(text).toContain(format === "latex" ? "% labshelf:style" : "// labshelf:style");
      expect(text).toContain(format === "latex" ? "% labshelf:style end" : "// labshelf:style end");
      expect(readSourceDeckStyle(format, text)?.style).toMatchObject({ primary: FOREST.primary, accent: FOREST.accent, background: FOREST.background });
    }
  });

  it("5.1d writes the style on a source Better Poster too", () => {
    for (const format of ["latex", "typst"] as const) {
      const text = fileText(choice("poster", format, "better-poster", { style: FOREST }));
      expect(readSourceDeckStyle(format, text)?.style.primary).toBe(FOREST.primary);
    }
  });

  it("A6 applies a Kit's style at creation in every format", () => {
    const kit = { name: "Institute", style: KIT_STYLE };
    for (const format of FORMATS) {
      for (const kind of ["talk", "poster"] as const) {
        const template = kind === "talk" ? "generic" : "better-poster";
        const out = files(choice(kind, format, template, { style: kit.style }));
        const read = format === "html"
          ? readThemeStyle(out.find((f) => f.path === "theme.css")!.text).style
          : readSourceDeckStyle(format, out[0]!.text)?.style;
        expect(read).toMatchObject({ primary: KIT_STYLE.primary, accent: KIT_STYLE.accent, background: KIT_STYLE.background });
      }
    }
  });

  it("A6 offers Better Poster in every format and creates it with a Kit style", () => {
    for (const format of FORMATS) expect(listDeckTemplates("poster", format).some((t) => t.id === "better-poster")).toBe(true);
    const deck = htmlDeck(choice("poster", "html", "better-poster", { style: KIT_STYLE }));
    expect(readPosterSettings(deck.theme, sizeOfDeck(deck.html).width, sizeOfDeck(deck.html).height).columns).toEqual([1, 2, 1]);
  });

  it("A6 creates every template of every format with every built-in palette", () => {
    for (const format of FORMATS) {
      for (const kind of ["talk", "poster"] as const) {
        for (const template of listDeckTemplates(kind, format)) {
          for (const preset of DECK_STYLE_PRESETS) {
            const size = listTemplateSizes(kind, format)[0]!.size;
            const out = files(choice(kind, format, template.id, { size, style: preset.style }));
            expect(out.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("scaffoldDeckFromTemplate: errors", () => {
  it("5.1e throws a RangeError for a bad deck name", () => {
    expect(isDeckName("Not a name!")).toBe(false);
    expect(() => files(choice("talk", "html", "blank"), "Not a name!")).toThrow(RangeError);
    expect(() => files(choice("talk", "latex", "blank"), "")).toThrow(RangeError);
  });

  it("5.1e throws a RangeError for an unknown template", () => {
    for (const format of FORMATS) expect(() => files(choice("talk", format, "nonexistent"))).toThrow(RangeError);
    expect(() => files(choice("talk", "html", "better-poster"))).toThrow(RangeError);
  });

  it("5.1e throws a RangeError for a size the kind does not allow", () => {
    expect(() => files(choice("talk", "html", "blank", { size: { w: 297, h: 210, unit: "mm" } }))).toThrow(RangeError);
    expect(() => files(choice("poster", "html", "generic", { size: { w: 1920, h: 1080, unit: "px" } }))).toThrow(RangeError);
  });

  it("5.1e throws a RangeError for a source size outside listTemplateSizes", () => {
    expect(() => files(choice("poster", "latex", "generic", { size: A3 }))).toThrow(RangeError);
    expect(() => files(choice("talk", "typst", "generic", { size: { w: 1280, h: 720, unit: "px" } }))).toThrow(RangeError);
  });

  it("5.1d throws a RangeError for a style that cannot be applied", () => {
    const bad = { ...DEFAULT_DECK_STYLE, primary: "not a colour" };
    for (const format of FORMATS) expect(() => files(choice("talk", format, "blank", { style: bad }))).toThrow(RangeError);
  });
});

describe("parseDeckTemplateChoice", () => {
  const valid = (): Record<string, unknown> => ({ kind: "poster", format: "html", template: "better-poster", title: "My poster", size: { ...A0 }, style: null });

  it("5.1e accepts a valid choice", () => {
    expect(parseDeckTemplateChoice(valid())).toEqual({ kind: "poster", format: "html", template: "better-poster", title: "My poster", size: A0, style: null });
  });

  it("5.1e accepts a valid choice for each kind and format with a listed size", () => {
    for (const format of FORMATS) {
      for (const kind of ["talk", "poster"] as const) {
        const size = listTemplateSizes(kind, format)[0]!.size;
        for (const template of listDeckTemplates(kind, format)) {
          expect(parseDeckTemplateChoice({ kind, format, template: template.id, title: "T", size, style: null })).toEqual({ kind, format, template: template.id, title: "T", size, style: null });
        }
      }
    }
  });

  it("5.1e accepts a free size for an HTML deck", () => {
    expect(parseDeckTemplateChoice({ ...valid(), size: { w: 500, h: 700, unit: "mm" } })?.size).toEqual({ w: 500, h: 700, unit: "mm" });
    expect(parseDeckTemplateChoice({ kind: "talk", format: "html", template: "blank", title: "T", size: { w: 1000, h: 600, unit: "px" }, style: null })).not.toBeNull();
  });

  it("5.1e trims the title", () => {
    expect(parseDeckTemplateChoice({ ...valid(), title: "  Spaced title  " })?.title).toBe("Spaced title");
  });

  it("5.1e accepts a valid style and normalises it", () => {
    const parsed = parseDeckTemplateChoice({ ...valid(), style: { ...DEFAULT_DECK_STYLE, primary: "#ABCDEF", accent: "#fff" } });
    expect(parsed?.style).toEqual({ ...DEFAULT_DECK_STYLE, primary: "#abcdef", accent: "#ffffff" });
  });

  it("5.1e rejects an unknown template", () => {
    expect(parseDeckTemplateChoice({ ...valid(), template: "fancy" })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), kind: "talk", template: "better-poster", size: TALK_16_9 })).toBeNull();
  });

  it("5.1e rejects an empty or blank title and a title that is not a string", () => {
    expect(parseDeckTemplateChoice({ ...valid(), title: "" })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), title: "   " })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), title: 7 })).toBeNull();
  });

  it("5.1e rejects a size the kind does not allow", () => {
    expect(parseDeckTemplateChoice({ ...valid(), size: { w: 1920, h: 1080, unit: "px" } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), size: { w: 50, h: 50, unit: "mm" } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), kind: "talk", template: "blank", size: { w: 100, h: 100, unit: "px" } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), size: "841x1189mm" })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), size: { w: "841", h: 1189, unit: "mm" } })).toBeNull();
  });

  it("5.1e rejects an A3 LaTeX poster and accepts an A0 one", () => {
    const latex = { ...valid(), format: "latex", template: "generic" };
    expect(parseDeckTemplateChoice({ ...latex, size: { ...A3 } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...latex, size: { ...A0 } })).not.toBeNull();
    expect(parseDeckTemplateChoice({ ...latex, size: { w: 1189, h: 841, unit: "mm" } })).not.toBeNull();
  });

  it("5.1e rejects a source talk size that is not 16:9 or 4:3", () => {
    const talk = { kind: "talk", format: "typst", template: "blank", title: "T", style: null };
    expect(parseDeckTemplateChoice({ ...talk, size: { ...TALK_16_9 } })).not.toBeNull();
    expect(parseDeckTemplateChoice({ ...talk, size: { w: 1920, h: 1200, unit: "px" } })).toBeNull();
  });

  it("5.1e rejects an invalid style", () => {
    expect(parseDeckTemplateChoice({ ...valid(), style: { ...DEFAULT_DECK_STYLE, primary: "blue" } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), style: { ...DEFAULT_DECK_STYLE, scale: 9 } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), style: { primary: "#ffffff" } })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), style: "Ocean" })).toBeNull();
  });

  it("5.1e rejects an unknown kind or format and a missing field", () => {
    expect(parseDeckTemplateChoice({ ...valid(), kind: "banner" })).toBeNull();
    expect(parseDeckTemplateChoice({ ...valid(), format: "word" })).toBeNull();
    const { title: _title, ...withoutTitle } = valid();
    expect(parseDeckTemplateChoice(withoutTitle)).toBeNull();
  });

  it("5.1e never throws on input that is not an object", () => {
    for (const raw of [null, undefined, 3, "text", [], true, () => 1, { size: null }]) expect(parseDeckTemplateChoice(raw)).toBeNull();
  });

  it("5.1e gives a parsed choice that scaffoldDeckFromTemplate accepts", () => {
    const parsed = parseDeckTemplateChoice({ ...valid(), style: FOREST })!;
    expect(() => files(parsed)).not.toThrow();
  });
});
