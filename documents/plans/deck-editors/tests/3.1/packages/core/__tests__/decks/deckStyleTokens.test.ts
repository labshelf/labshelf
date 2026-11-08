// Tests the Style tokens: defaults and validation, the WCAG contrast pairs and the diff of the labshelf:style block.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DECK_STYLE_TOKENS, DEFAULT_DECK_STYLE, deckStyleContrast, diffDeckStyleBlock, validateDeckStyle } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { readSourceDeckStyle, setSourceDeckStyle } from "../../src/decks/deckStyleSource.js";
import type { SourceDeckFormat } from "../../src/decks/sourceDecks.js";

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
const withStyle = (patch: Partial<DeckStyle>): DeckStyle => ({ ...DEFAULT_DECK_STYLE, ...patch });

describe("3.1 tokens and defaults", () => {
  it("3.1d names the nine tokens in the order of the type", () => {
    expect(DECK_STYLE_TOKENS).toEqual(["primary", "accent", "background", "text", "muted", "headingFont", "bodyFont", "monoFont", "scale"]);
  });

  it("3.1d has the decided default style", () => {
    expect(DEFAULT_DECK_STYLE).toEqual({
      primary: "#1f5673", accent: "#c75b12", background: "#ffffff", text: "#1a1a1a", muted: "#6b7280",
      headingFont: "Inter", bodyFont: "Inter", monoFont: "JetBrains Mono", scale: 1,
    });
  });
});

describe("3.1d validateDeckStyle", () => {
  it("3.1d returns no problem for the default style", () => {
    expect(validateDeckStyle(DEFAULT_DECK_STYLE)).toEqual([]);
  });

  it("3.1d accepts #rgb and upper case colours, trimmed fonts and the scale limits", () => {
    expect(validateDeckStyle(withStyle({ primary: "#ABC", accent: "#C75B12", scale: 0.5 }))).toEqual([]);
    expect(validateDeckStyle(withStyle({ scale: 3, bodyFont: " Source Serif 4 ", monoFont: "Fira.Code-2_x+" }))).toEqual([]);
  });

  it.each(["primary", "accent", "background", "text", "muted"] as const)("3.1d names the colour %s when it is not hex", (token) => {
    for (const bad of ["red", "#12345", "#gggggg", "1f5673", "rgb(1,2,3)", ""]) {
      const problems = validateDeckStyle(withStyle({ [token]: bad } as Partial<DeckStyle>));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(token);
    }
  });

  it.each(["headingFont", "bodyFont", "monoFont"] as const)("3.1d names the font %s when it has quotes, braces or is empty", (token) => {
    for (const bad of ['Fira "Code"', "Fira {Code}", "Fira}", "Fira'Code", "a\\b", "", "   "]) {
      const problems = validateDeckStyle(withStyle({ [token]: bad } as Partial<DeckStyle>));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(token);
    }
  });

  it("3.1d names the scale when it is outside 0.5 to 3 or not a number", () => {
    for (const bad of [0.49, 0, -1, 3.01, 10, Number.NaN]) {
      const problems = validateDeckStyle(withStyle({ scale: bad }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("scale");
    }
  });

  it("3.1d gives one problem per bad token", () => {
    const problems = validateDeckStyle(withStyle({ primary: "red", bodyFont: "a{b}", scale: 9 }));
    expect(problems).toHaveLength(3);
    expect(problems.some((p) => p.includes("primary"))).toBe(true);
    expect(problems.some((p) => p.includes("bodyFont"))).toBe(true);
    expect(problems.some((p) => p.includes("scale"))).toBe(true);
  });
});

describe("3.1e deckStyleContrast", () => {
  it("3.1e rates #1a1a1a on #ffffff at about 17.4 and ok", () => {
    const text = deckStyleContrast(DEFAULT_DECK_STYLE)[0]!;
    expect(text.pair).toBe("text");
    expect(text.foreground).toBe("#1a1a1a");
    expect(text.background).toBe("#ffffff");
    expect(text.ratio).toBeCloseTo(17.4, 1);
    expect(text.minimum).toBe(4.5);
    expect(text.ok).toBe(true);
  });

  it("3.1e rates #777777 text on #ffffff at 4.48 and not ok against the minimum 4.5", () => {
    const text = deckStyleContrast(withStyle({ text: "#777777" }))[0]!;
    expect(text.ratio).toBe(4.48);
    expect(text.minimum).toBe(4.5);
    expect(text.ok).toBe(false);
  });

  it("3.1e returns four pairs in the order text, muted, primary, accent with their minimums", () => {
    const pairs = deckStyleContrast(DEFAULT_DECK_STYLE);
    expect(pairs.map((p) => p.pair)).toEqual(["text", "muted", "primary", "accent"]);
    expect(pairs.map((p) => p.minimum)).toEqual([4.5, 3, 3, 3]);
    expect(pairs.map((p) => p.foreground)).toEqual(["#1a1a1a", "#6b7280", "#1f5673", "#c75b12"]);
    expect(pairs.every((p) => p.background === "#ffffff")).toBe(true);
  });

  it("3.1e rounds the ratio to two decimals", () => {
    for (const pair of deckStyleContrast(DEFAULT_DECK_STYLE)) expect(pair.ratio).toBe(Math.round(pair.ratio * 100) / 100);
  });

  it("3.1e gives 21 for black on white and 1 for a colour on itself, with ok following the minimum", () => {
    const [text] = deckStyleContrast(withStyle({ text: "#000000" }));
    expect(text!.ratio).toBe(21);
    const same = deckStyleContrast(withStyle({ primary: "#ffffff", muted: "#ffffff", accent: "#ffffff" }));
    expect(same.slice(1).map((p) => p.ratio)).toEqual([1, 1, 1]);
    expect(same.slice(1).every((p) => !p.ok)).toBe(true);
  });

  it("3.1e measures against the given background, not white", () => {
    const [text] = deckStyleContrast(withStyle({ background: "#000000", text: "#ffffff" }));
    expect(text!.ratio).toBe(21);
    expect(text!.background).toBe("#000000");
    const dark = deckStyleContrast(withStyle({ background: "#000000", text: "#111111" }))[0]!;
    expect(dark.ok).toBe(false);
  });
});

describe("3.1f diffDeckStyleBlock", () => {
  const cases: Array<{ name: string; format: SourceDeckFormat; file: string; changed: (hex: string) => string; before: string; after: string }> = [
    {
      name: "beamer", format: "latex", file: "defesa-beamer.tex", changed: (hex) => `\\definecolor{lsPrimary}{HTML}{${hex}}`, before: "1F5673", after: "A1B2C3",
    },
    {
      name: "typst", format: "typst", file: "typst-a0.typ", changed: (hex) => `#let ls-primary = rgb("#${hex}")`, before: "1f5673", after: "a1b2c3",
    },
  ];

  const blockOf = (format: SourceDeckFormat, text: string, style: DeckStyle): string => {
    const changed = setSourceDeckStyle(format, text, style)!;
    return readSourceDeckStyle(format, changed.text)!.block!.text;
  };

  it.each(cases)("3.1f diffs a primary change in $name as exactly the changed line removed and added", ({ format, file, changed, before, after }) => {
    const text = fixture(file);
    const first = blockOf(format, text, DEFAULT_DECK_STYLE);
    const second = blockOf(format, text, withStyle({ primary: "#a1b2c3" }));
    const diff = diffDeckStyleBlock(first, second);
    expect(diff.filter((l) => l.kind === "removed").map((l) => l.text.trim())).toEqual([changed(before)]);
    expect(diff.filter((l) => l.kind === "added").map((l) => l.text.trim())).toEqual([changed(after)]);
    expect(diff.every((l) => l.kind === "same" || l.kind === "gap" || l.kind === "removed" || l.kind === "added")).toBe(true);
  });

  it.each(cases)("3.1f gives only added lines from an empty before in $name", ({ format, file }) => {
    const block = blockOf(format, fixture(file), DEFAULT_DECK_STYLE);
    const diff = diffDeckStyleBlock("", block);
    expect(diff.length).toBeGreaterThan(5);
    expect(diff.every((l) => l.kind === "added")).toBe(true);
    expect(diff.map((l) => l.text).join("\n").trim()).toBe(block.trim());
  });

  it.each(cases)("3.1f has no removed or added line when the block is unchanged in $name", ({ format, file }) => {
    const block = blockOf(format, fixture(file), DEFAULT_DECK_STYLE);
    expect(diffDeckStyleBlock(block, block).some((l) => l.kind === "added" || l.kind === "removed")).toBe(false);
  });
});

describe("3.1f diffDeckStyleBlock written out", () => {
  it("3.1f has exactly the \\definecolor{lsPrimary} line removed and added for a primary change in a beamer block", () => {
    const text = fixture("defesa-beamer.tex");
    const first = readSourceDeckStyle("latex", setSourceDeckStyle("latex", text, DEFAULT_DECK_STYLE)!.text)!.block!.text;
    const second = readSourceDeckStyle("latex", setSourceDeckStyle("latex", text, withStyle({ primary: "#a1b2c3" }))!.text)!.block!.text;
    const diff = diffDeckStyleBlock(first, second);
    expect(diff.filter((l) => l.kind === "removed").map((l) => l.text.trim())).toEqual(["\\definecolor{lsPrimary}{HTML}{1F5673}"]);
    expect(diff.filter((l) => l.kind === "added").map((l) => l.text.trim())).toEqual(["\\definecolor{lsPrimary}{HTML}{A1B2C3}"]);
  });

  it("3.1f has every line added when the block is new", () => {
    const text = fixture("typst-a0.typ");
    const block = readSourceDeckStyle("typst", setSourceDeckStyle("typst", text, DEFAULT_DECK_STYLE)!.text)!.block!.text;
    const diff = diffDeckStyleBlock("", block);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((l) => l.kind === "added")).toBe(true);
  });
});
