/** @jest-environment jsdom */
// Pins the deck template catalog: the poster section templates, listDeckTemplates, listTemplateSizes and parseDeckTemplateChoice.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import { DECK_STYLE_PRESETS } from "../../src/decks/deckStylePresets.js";
import { listDeckSizePresets, type DeckKind } from "../../src/decks/deckSizes.js";
import * as decks from "../../src/decks/index.js";
import { POSTER_SECTION_TEMPLATES, listDeckTemplates, listTemplateSizes, parseDeckTemplateChoice, type DeckTemplateFormat } from "../../src/decks/deckTemplates.js";
import { A0, A3, FORMATS, FOREST, TALK_16_9, choice, files } from "./deckTemplatesHarness.js";

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
