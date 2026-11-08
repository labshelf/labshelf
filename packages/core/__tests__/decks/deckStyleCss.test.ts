// Hidden tests of spec 3.2: the Style tokens of an HTML deck as a labshelf:style section inside theme.css's :root rule.
import { scaffoldDeck } from "../../src/decks/deckProject";
import { readThemeProperties } from "../../src/decks/themeCss";
import { readThemeStyle, setThemeStyle, THEME_STYLE_PROPERTIES } from "../../src/decks/deckStyleCss";
import { DEFAULT_DECK_STYLE, DECK_STYLE_TOKENS, type DeckStyle } from "../../src/decks/deckStyleTokens";

const scaffold = scaffoldDeck("talk", "demo").theme;

const STYLE: DeckStyle = {
  primary: "#0a5c36",
  accent: "#d97706",
  background: "#fafafa",
  text: "#111827",
  muted: "#6b7280",
  headingFont: "Fira Sans",
  bodyFont: "Inter",
  monoFont: "JetBrains Mono",
  scale: 1.25,
};

const BLOCK = [
  "  /* labshelf:style */",
  "  --deck-primary: #0a5c36;",
  "  --deck-accent: #d97706;",
  "  --deck-bg: #fafafa;",
  "  --deck-fg: #111827;",
  "  --deck-muted: #6b7280;",
  "  --deck-heading-font: Fira Sans;",
  "  --deck-font: Inter;",
  "  --deck-mono-font: JetBrains Mono;",
  "  --deck-scale: 1.25;",
  "  /* labshelf:style end */",
  "",
].join("\n");

const written = (css: string, style: DeckStyle = STYLE): string => {
  const out = setThemeStyle(css, style);
  if (out === null) throw new Error("setThemeStyle returned null");
  return out;
};

describe("THEME_STYLE_PROPERTIES", () => {
  it("3.2a names the custom property of every token", () => {
    expect(THEME_STYLE_PROPERTIES).toEqual({
      primary: "--deck-primary",
      accent: "--deck-accent",
      background: "--deck-bg",
      text: "--deck-fg",
      muted: "--deck-muted",
      headingFont: "--deck-heading-font",
      bodyFont: "--deck-font",
      monoFont: "--deck-mono-font",
      scale: "--deck-scale",
    });
    expect(Object.keys(THEME_STYLE_PROPERTIES).sort()).toEqual([...DECK_STYLE_TOKENS].sort());
  });
});

describe("setThemeStyle on the scaffold theme", () => {
  it("3.2a appends the block at the end of :root in the decided form and changes no byte outside it", () => {
    const closing = "}\n\nbody {";
    expect(scaffold).toContain(closing);
    expect(written(scaffold)).toBe(scaffold.replace(closing, BLOCK + closing));
  });

  it("3.2a keeps every byte before and after the block (checked through the block range)", () => {
    const out = written(scaffold);
    const { block } = readThemeStyle(out);
    expect(block).not.toBeNull();
    expect(out.slice(block!.from, block!.to)).toBe(block!.text);
    expect(block!.text).toContain("/* labshelf:style */");
    expect(block!.text).toContain("/* labshelf:style end */");
    expect(out.slice(0, block!.from) + out.slice(block!.to)).toBe(scaffold);
  });

  it("3.2a writes the tokens in DECK_STYLE_TOKENS order with the decided property names", () => {
    const out = written(scaffold);
    const lines = out.slice(out.indexOf("/* labshelf:style */"), out.indexOf("/* labshelf:style end */")).split("\n");
    const names = lines.map((l) => /^\s*(--[a-z-]+):/.exec(l)?.[1]).filter(Boolean);
    expect(names).toEqual(DECK_STYLE_TOKENS.map((token) => THEME_STYLE_PROPERTIES[token]));
  });

  it("3.2a reads back exactly the written style", () => {
    expect(readThemeStyle(written(scaffold)).style).toEqual(STYLE);
  });

  it("3.2a reads back the default style", () => {
    expect(readThemeStyle(written(scaffold, DEFAULT_DECK_STYLE)).style).toEqual(DEFAULT_DECK_STYLE);
  });

  it("3.2a writing the same style again returns the same text", () => {
    const once = written(scaffold);
    expect(written(once)).toBe(once);
  });

  it("3.2a replaces an existing block in place, so the result equals a first write of the new style", () => {
    const next: DeckStyle = { ...STYLE, primary: "#112233", bodyFont: "Lora", scale: 2 };
    const replaced = written(written(scaffold), next);
    expect(replaced).toBe(written(scaffold, next));
    expect(replaced.match(/labshelf:style end/g)).toHaveLength(1);
    expect(readThemeStyle(replaced).style).toEqual(next);
  });

  it("3.2a leaves the scaffold's own :root declarations in place, before the block", () => {
    const out = written(scaffold);
    expect(out.indexOf("--deck-font: system-ui, sans-serif;")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("--deck-font: system-ui, sans-serif;")).toBeLessThan(out.indexOf("/* labshelf:style */"));
  });
});

describe("readThemeStyle without a block", () => {
  it("3.2b reads the legacy names of the scaffold theme and gives a null block", () => {
    const read = readThemeStyle(scaffold);
    expect(read.block).toBeNull();
    expect(read.style).toEqual({ background: "#ffffff", text: "#1a1a1a", accent: "#2563eb" });
  });

  it("3.2b leaves bodyFont absent because 'system-ui, sans-serif' is not one family name", () => {
    expect("bodyFont" in readThemeStyle(scaffold).style).toBe(false);
  });

  it("3.2b reads a single-family legacy --deck-font as bodyFont", () => {
    const css = ":root {\n  --deck-font: Inter;\n}\n";
    expect(readThemeStyle(css)).toEqual({ block: null, style: { bodyFont: "Inter" } });
  });

  it("3.2b takes the last legacy declaration when a name repeats", () => {
    const css = ":root {\n  --deck-bg: #ffffff;\n  --deck-bg: #000000;\n}\n";
    expect(readThemeStyle(css).style).toEqual({ background: "#000000" });
  });

  it("3.2b gives style {} and a null block for a css with no :root rule", () => {
    expect(readThemeStyle("body { margin: 0; }\n")).toEqual({ block: null, style: {} });
    expect(readThemeStyle("")).toEqual({ block: null, style: {} });
  });
});

describe("hand edits and edge cases", () => {
  const handEdited = [
    ":root {",
    "  /* labshelf:style */",
    "  /* my own note */",
    "  --deck-primary:   #ABC ;",
    "  --deck-accent:#C75B12;",
    "  /* --deck-text: #000000; */",
    "  --deck-muted: red;",
    "  --deck-heading-font: Fira Sans;",
    "  --unrelated: 3;",
    "  /* labshelf:style end */",
    "}",
    "",
  ].join("\n");

  it("3.2c reads a hand-edited block back normalised, skipping comments, spaces and unknown lines", () => {
    const read = readThemeStyle(handEdited);
    expect(read.block).not.toBeNull();
    expect(read.style).toEqual({ primary: "#aabbcc", accent: "#c75b12", headingFont: "Fira Sans" });
  });

  it("3.2c leaves a token with an invalid value absent", () => {
    const style = readThemeStyle(handEdited).style;
    expect("muted" in style).toBe(false);
    expect("text" in style).toBe(false);
  });

  it("3.2c rewriting a hand-edited block replaces only the block", () => {
    const { block } = readThemeStyle(handEdited);
    const out = written(handEdited);
    expect(out.startsWith(handEdited.slice(0, block!.from))).toBe(true);
    expect(out.endsWith(handEdited.slice(block!.to))).toBe(true);
    expect(out.match(/labshelf:style end/g)).toHaveLength(1);
    expect(out).not.toContain("my own note");
    expect(readThemeStyle(out).style).toEqual(STYLE);
  });

  it("3.2c normalises #rgb and upper case colours on write", () => {
    const out = written(scaffold, { ...STYLE, primary: "#ABC", accent: "#D97706" });
    expect(out).toContain("  --deck-primary: #aabbcc;\n");
    expect(out).toContain("  --deck-accent: #d97706;\n");
    expect(readThemeStyle(out).style).toMatchObject({ primary: "#aabbcc", accent: "#d97706" });
  });

  it("3.2c appends a new :root rule with the block at the end of a css with no :root", () => {
    const css = "body {\n  margin: 0;\n}\n";
    const out = written(css);
    expect(out.startsWith(css + ":root {\n" + BLOCK + "}")).toBe(true);
    expect(out.slice((css + ":root {\n" + BLOCK + "}").length)).toMatch(/^\n?$/);
    expect(readThemeStyle(out).style).toEqual(STYLE);
  });

  it("3.2c puts a newline before the new :root rule when the css does not end in one", () => {
    const css = "body { margin: 0; }";
    const out = written(css);
    expect(out.startsWith(css + "\n:root {\n" + BLOCK + "}")).toBe(true);
  });

  it("3.2c writes the new :root rule for an empty css", () => {
    const out = written("");
    expect(out.startsWith(":root {\n" + BLOCK + "}")).toBe(true);
    expect(readThemeStyle(out).style).toEqual(STYLE);
  });

  it("3.2c ignores a :root inside an at-rule and appends a top-level one", () => {
    const css = "@media print {\n  :root { --deck-bg: #000000; }\n}\n";
    const out = written(css);
    expect(out.startsWith(css + ":root {\n")).toBe(true);
    expect(readThemeStyle(out).style).toEqual(STYLE);
  });

  it("3.2c returns null for an opening marker without its end", () => {
    const css = ":root {\n  /* labshelf:style */\n  --deck-primary: #ffffff;\n}\n";
    expect(setThemeStyle(css, STYLE)).toBeNull();
  });

  it("3.2c returns null for an invalid colour", () => {
    expect(setThemeStyle(scaffold, { ...STYLE, primary: "red" })).toBeNull();
  });

  it("3.2c returns null for a font with quotes or braces", () => {
    expect(setThemeStyle(scaffold, { ...STYLE, bodyFont: "'Inter'" })).toBeNull();
    expect(setThemeStyle(scaffold, { ...STYLE, headingFont: "Fira{Sans}" })).toBeNull();
  });

  it("3.2c returns null for a scale outside 0.5 to 3", () => {
    expect(setThemeStyle(scaffold, { ...STYLE, scale: 0.4 })).toBeNull();
    expect(setThemeStyle(scaffold, { ...STYLE, scale: 3.5 })).toBeNull();
  });
});

describe("compatibility with the theme property helpers", () => {
  it("3.2d readThemeProperties lists the block's declarations as ordinary :root declarations", () => {
    const props = readThemeProperties(written(scaffold));
    const find = (name: string) => props.filter((p) => p.name === name).map((p) => p.value);
    expect(find("--deck-primary")).toEqual(["#0a5c36"]);
    expect(find("--deck-heading-font")).toEqual(["Fira Sans"]);
    expect(find("--deck-scale")).toEqual(["1.25"]);
    expect(find("--deck-font").at(-1)).toBe("Inter");
  });
});

describe("one theme string", () => {
  it("A5 setThemeStyle returns one whole theme string that readThemeStyle reads back exactly", () => {
    const out = setThemeStyle(scaffold, STYLE);
    expect(typeof out).toBe("string");
    expect(readThemeStyle(out as string).style).toEqual(STYLE);
  });
});
