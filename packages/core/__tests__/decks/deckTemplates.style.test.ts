/** @jest-environment jsdom */
// Pins scaffoldDeckFromTemplate: the style a template carries and its refusal errors.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { isDeckName } from "../../src/decks/deckProject.js";
import { readThemeStyle } from "../../src/decks/deckStyleCss.js";
import { readSourceDeckStyle } from "../../src/decks/deckStyleSource.js";
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import { DECK_STYLE_PRESETS } from "../../src/decks/deckStylePresets.js";
import { readPosterSettings } from "../../src/decks/posterSections.js";
import { listDeckTemplates, listTemplateSizes } from "../../src/decks/deckTemplates.js";
import { A3, FORMATS, FOREST, KIT_STYLE, choice, fileText, files, htmlDeck, sizeOfDeck } from "./deckTemplatesHarness.js";

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

