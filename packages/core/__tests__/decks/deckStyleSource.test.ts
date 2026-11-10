// Tests the Style block of LaTeX and Typst decks: the template of a source and writing the block in place.
// These tests run Typst decks, which are off in the product.
jest.mock("../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { readSourceDeckStyle, sourceDeckTemplate } from "../../src/decks/deckStyleSource.js";
import { CASES, blockOf, fixture, withStyle, write } from "./deckStyleFixtures.js";

const CUSTOM: DeckStyle = {
  primary: "#123456", accent: "#abcdef", background: "#fafafa", text: "#111111", muted: "#555555",
  headingFont: "Fira Sans", bodyFont: "Source Serif 4", monoFont: "Fira Code", scale: 1.25,
};

const trimmedLines = (text: string): string[] => text.split("\n").map((line) => line.trim());
const stripped = (text: string): string => text.replace(/\s+/g, "");

describe("3.1a sourceDeckTemplate", () => {
  it.each(CASES)("3.1a names $template for $file", ({ format, file, template }) => {
    expect(sourceDeckTemplate(format, fixture(file))).toBe(template);
  });

  it("3.1a gives null for a LaTeX article", () => {
    expect(sourceDeckTemplate("latex", "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n")).toBeNull();
  });

  it("3.1a gives null for a Typst file with neither a marker nor a deck import", () => {
    expect(sourceDeckTemplate("typst", "#set page(width: 10cm)\n= Notes\nPlain text.\n")).toBeNull();
    expect(sourceDeckTemplate("typst", "#import \"@preview/cetz:0.3.0\"\nHello\n")).toBeNull();
  });

  it("3.1a names typst for a marked Typst file with no template import", () => {
    expect(sourceDeckTemplate("typst", "// labshelf: talk\n= Hi\n")).toBe("typst");
  });

  it("3.1a ignores comments when detecting the template", () => {
    const beamer = "\\documentclass{beamer}\n% \\usepackage{beamerposter}\n\\begin{document}\n\\end{document}\n";
    expect(sourceDeckTemplate("latex", beamer)).toBe("beamer");
    const typst = "// labshelf: talk\n// #import \"@preview/touying:0.5.2\": *\n= Hi\n";
    expect(sourceDeckTemplate("typst", typst)).toBe("typst");
  });

  it("3.1a names beamerposter for class beamer with the beamerposter package and tikzposter for its class", () => {
    expect(sourceDeckTemplate("latex", "\\documentclass{beamer}\n\\usepackage[size=a1]{beamerposter}\n\\begin{document}\n\\end{document}\n")).toBe("beamerposter");
    expect(sourceDeckTemplate("latex", "\\documentclass[a1paper]{tikzposter}\n\\begin{document}\n\\end{document}\n")).toBe("tikzposter");
  });
});

describe("3.1b setSourceDeckStyle places the block", () => {
  it.each(CASES)("3.1b inserts one block at the decided place in $name and touches nothing else", ({ format, file, after, before, notBefore }) => {
    const input = fixture(file);
    const change = write(format, input);
    const read = readSourceDeckStyle(format, change.text)!;
    const block = read.block!;
    expect(block).not.toBeNull();
    expect(change.text.slice(0, block.from) + change.text.slice(block.to)).toBe(input);
    expect(change.text.slice(block.from, block.to)).toBe(block.text);
    expect(change.cursor).toBe(block.from);
    if (after !== undefined) expect(block.from).toBe(input.indexOf(after) + after.length);
    if (notBefore !== undefined) expect(block.from).toBeGreaterThanOrEqual(input.indexOf(notBefore) + notBefore.length);
    expect(block.to).toBeLessThanOrEqual(change.text.indexOf(before, block.to));
    expect(change.text.indexOf(before, block.to)).toBeGreaterThanOrEqual(0);
    expect(change.text.indexOf(before)).toBeGreaterThanOrEqual(block.to);
  });

  it.each(CASES)("3.1b reads back exactly the written style in $name", ({ format, file, template }) => {
    const input = fixture(file);
    const read = readSourceDeckStyle(format, write(format, input, CUSTOM).text)!;
    expect(read.template).toBe(template);
    expect(read.style).toEqual(CUSTOM);
  });

  it.each(CASES)("3.1b reads the default style back in $name", ({ format, file }) => {
    expect(readSourceDeckStyle(format, write(format, fixture(file)).text)!.style).toEqual(DEFAULT_DECK_STYLE);
  });

  it.each(CASES)("3.1b writes the same text when the same style is written again in $name", ({ format, file }) => {
    const once = write(format, fixture(file), CUSTOM);
    const twice = write(format, once.text, CUSTOM);
    expect(twice.text).toBe(once.text);
    expect(twice.cursor).toBe(once.cursor);
  });

  it.each(CASES)("3.1b replaces the block in place with another style in $name", ({ format, file }) => {
    const input = fixture(file);
    const first = write(format, input, DEFAULT_DECK_STYLE);
    const second = write(format, first.text, CUSTOM);
    const a = blockOf(format, first.text);
    const b = blockOf(format, second.text);
    expect(second.text.slice(0, b.from)).toBe(first.text.slice(0, a.from));
    expect(second.text.slice(b.to)).toBe(first.text.slice(a.to));
    expect(second.text).not.toBe(first.text);
    expect(second.text.match(/labshelf:style end/g)).toHaveLength(1);
    expect(second.text.match(/labshelf:style(?! end)/g)).toHaveLength(1);
  });

  it("3.1b normalises #rgb and upper case colours on write", () => {
    const text = write("latex", fixture("defesa-beamer.tex"), withStyle({ primary: "#ABC", accent: "#C75B12", bodyFont: " Lato " })).text;
    const style = readSourceDeckStyle("latex", text)!.style;
    expect(style.primary).toBe("#aabbcc");
    expect(style.accent).toBe("#c75b12");
    expect(style.bodyFont).toBe("Lato");
  });

  it("3.1b places the LaTeX block after the last use-line when later lines are not preamble packages", () => {
    const input = "\\documentclass{beamer}\n\\usetheme{Madrid}\n\\usecolortheme{beaver}\n\\setbeamertemplate{navigation symbols}{}\n\\title{T}\n\\begin{document}\n\\end{document}\n";
    const anchor = "\\usecolortheme{beaver}\n";
    expect(blockOf("latex", write("latex", input).text).from).toBe(input.indexOf(anchor) + anchor.length);
  });

  it("3.1b ignores a preamble-looking line after \\begin{document}", () => {
    const input = "\\documentclass{beamer}\n\\usepackage{amsmath}\n\\begin{document}\n\\usepackage{late}\n\\end{document}\n";
    const out = write("latex", input).text;
    expect(blockOf("latex", out).from).toBe(input.indexOf("\\begin{document}"));
  });

  it("3.1b waits for a multi-line Typst statement to balance before placing the block", () => {
    const input = "// labshelf: talk\n#let f(x) = {\n  x + 1\n}\n#set text(size: 20pt)\n\n= Title\n";
    const out = write("typst", input).text;
    const anchor = "#set text(size: 20pt)\n";
    expect(blockOf("typst", out).from).toBe(input.indexOf(anchor) + anchor.length);
  });

  it("3.1b adds the newline a block needs when the preamble ends the file", () => {
    const input = "// labshelf: talk\n#set text(size: 20pt)";
    const out = write("typst", input).text;
    const block = blockOf("typst", out);
    expect(out.slice(0, block.from)).toContain("#set text(size: 20pt)");
    expect(out.slice(0, block.from).endsWith("\n")).toBe(true);
    expect(out.slice(0, block.from).trimEnd()).toBe(input);
  });

  it("3.1b starts a touying block before the show-everything rule", () => {
    const input = fixture("touying.typ");
    const out = write("typst", input).text;
    expect(out.indexOf("labshelf:style")).toBeLessThan(out.indexOf("#show: simple-theme"));
  });

  it("3.1b counts peace-of-posters theme calls with an alias as preamble and ignores them without", () => {
    const input = fixture("peace-of-posters.typ");
    const block = blockOf("typst", write("typst", input).text);
    expect(block.from).toBeGreaterThanOrEqual(input.indexOf("#pop.set-theme(pop.uni-fr)\n"));
  });
});

describe("3.1b the canonical LaTeX block", () => {
  const COMMON = [
    "\\definecolor{lsPrimary}{HTML}{1F5673}",
    "\\definecolor{lsAccent}{HTML}{C75B12}",
    "\\definecolor{lsBackground}{HTML}{FFFFFF}",
    "\\definecolor{lsText}{HTML}{1A1A1A}",
    "\\definecolor{lsMuted}{HTML}{6B7280}",
    "\\def\\lsScale{1}",
    "\\iftutex",
    "\\usepackage{fontspec}",
    "\\setmainfont{Inter}",
    "\\setsansfont{Inter}",
    "\\setmonofont{JetBrains Mono}",
    "\\newfontfamily\\lsHeadingFont{Inter}",
    "\\else",
    "\\let\\lsHeadingFont\\relax",
    "\\fi",
  ];
  const BEAMER = [
    "\\setbeamercolor{normal text}{fg=lsText,bg=lsBackground}",
    "\\setbeamercolor{background canvas}{bg=lsBackground}",
    "\\setbeamercolor{structure}{fg=lsPrimary}",
    "\\setbeamercolor{frametitle}{fg=lsPrimary,bg=lsBackground}",
    "\\setbeamercolor{title}{fg=lsPrimary,bg=lsBackground}",
    "\\setbeamercolor{block title}{fg=lsBackground,bg=lsPrimary}",
    "\\setbeamercolor{alerted text}{fg=lsAccent}",
    "\\setbeamercolor{footline}{fg=lsMuted}",
    "\\setbeamerfont{frametitle}{family=\\lsHeadingFont}",
    "\\setbeamerfont{title}{family=\\lsHeadingFont}",
  ];
  const TIKZ_COLORS: Array<[string, string]> = [
    ["backgroundcolor", "lsBackground"], ["framecolor", "lsPrimary"], ["titlefgcolor", "lsBackground"], ["titlebgcolor", "lsPrimary"],
    ["blocktitlebgcolor", "lsPrimary"], ["blocktitlefgcolor", "lsBackground"], ["blockbodybgcolor", "lsBackground"], ["blockbodyfgcolor", "lsText"],
    ["innerblocktitlebgcolor", "lsAccent"], ["innerblocktitlefgcolor", "lsBackground"], ["innerblockbodybgcolor", "lsBackground"],
    ["innerblockbodyfgcolor", "lsText"], ["notefgcolor", "lsText"], ["notebgcolor", "lsBackground"], ["noteframecolor", "lsMuted"],
  ];

  const lines = (file: string): string[] => trimmedLines(blockOf("latex", write("latex", fixture(file)).text).text);

  it("3.1b opens with % labshelf:style and closes with % labshelf:style end on their own lines", () => {
    for (const file of ["defesa-beamer.tex", "beamerposter.tex", "a1-tikz.tex"]) {
      const block = blockOf("latex", write("latex", fixture(file)).text);
      const all = trimmedLines(block.text.replace(/\n$/, ""));
      expect(all[0]).toBe("% labshelf:style");
      expect(all[all.length - 1]).toBe("% labshelf:style end");
      expect(block.text.endsWith("\n")).toBe(true);
    }
  });

  it.each(["defesa-beamer.tex", "beamerposter.tex", "a1-tikz.tex"])("3.1b writes the common lines in %s", (file) => {
    const got = lines(file);
    for (const line of COMMON) expect(got).toContain(line);
    expect(got.indexOf("\\iftutex")).toBeLessThan(got.indexOf("\\else"));
    expect(got.indexOf("\\else")).toBeLessThan(got.indexOf("\\fi"));
  });

  it.each(["defesa-beamer.tex", "beamerposter.tex"])("3.1b writes the beamer colours and fonts in %s", (file) => {
    const got = lines(file);
    for (const line of BEAMER) expect(got).toContain(line);
  });

  it("3.1b writes no tikzposter colour style for beamer", () => {
    expect(lines("defesa-beamer.tex").some((line) => line.includes("\\definecolorstyle"))).toBe(false);
  });

  it("3.1b writes the tikzposter colour style and uses it", () => {
    const got = lines("a1-tikz.tex");
    const head = "\\definecolorstyle{labshelf}{\\colorlet{colorOne}{lsPrimary}\\colorlet{colorTwo}{lsAccent}\\colorlet{colorThree}{lsMuted}}{";
    expect(got).toContain(head);
    for (const [name, colour] of TIKZ_COLORS) expect(got).toContain(`\\colorlet{${name}}{${colour}}`);
    expect(got).toContain("\\usecolorstyle{labshelf}");
    expect(got.indexOf(head)).toBeLessThan(got.indexOf("\\colorlet{framecolor}{lsPrimary}"));
    expect(got.indexOf("\\colorlet{noteframecolor}{lsMuted}")).toBeLessThan(got.indexOf("\\usecolorstyle{labshelf}"));
  });

  it("3.1b writes the given colours in upper case without # and the scale and fonts", () => {
    const got = trimmedLines(blockOf("latex", write("latex", fixture("defesa-beamer.tex"), CUSTOM).text).text);
    expect(got).toContain("\\definecolor{lsPrimary}{HTML}{123456}");
    expect(got).toContain("\\definecolor{lsAccent}{HTML}{ABCDEF}");
    expect(got).toContain("\\def\\lsScale{1.25}");
    expect(got).toContain("\\setmainfont{Source Serif 4}");
    expect(got).toContain("\\setmonofont{Fira Code}");
    expect(got).toContain("\\newfontfamily\\lsHeadingFont{Fira Sans}");
  });
});

describe("3.1b the canonical Typst block", () => {
  const COLOURS = [
    '#let ls-primary = rgb("#1f5673")',
    '#let ls-accent = rgb("#c75b12")',
    '#let ls-background = rgb("#ffffff")',
    '#let ls-text = rgb("#1a1a1a")',
    '#let ls-muted = rgb("#6b7280")',
  ];
  const VARS = ['#let ls-heading-font = "Inter"', '#let ls-body-font = "Inter"', '#let ls-mono-font = "JetBrains Mono"', "#let ls-scale = 1"];
  const RULES = [
    "#set text(font: ls-body-font, fill: ls-text, size: ls-scale * 1em)",
    "#show heading: set text(font: ls-heading-font, fill: ls-primary)",
    "#show raw: set text(font: ls-mono-font)",
    "#show link: set text(fill: ls-accent)",
  ];
  const PAGE = "#set page(fill: ls-background)";

  const block = (file: string): string => blockOf("typst", write("typst", fixture(file)).text).text;
  const lines = (file: string): string[] => trimmedLines(block(file));

  it("3.1b opens with // labshelf:style and closes with // labshelf:style end on their own lines", () => {
    for (const file of ["typst-a0.typ", "typst-relampago.typ", "touying.typ", "peace-of-posters.typ"]) {
      const text = block(file);
      const all = trimmedLines(text.replace(/\n$/, ""));
      expect(all[0]).toBe("// labshelf:style");
      expect(all[all.length - 1]).toBe("// labshelf:style end");
      expect(text.endsWith("\n")).toBe(true);
    }
  });

  it.each(["typst-a0.typ", "typst-relampago.typ", "touying.typ", "peace-of-posters.typ"])("3.1b writes the colour and font variables in %s", (file) => {
    const got = lines(file);
    for (const line of [...COLOURS, ...VARS]) expect(got).toContain(line);
  });

  it.each(["typst-a0.typ", "typst-relampago.typ"])("3.1b writes the plain rules including the page fill in %s", (file) => {
    const got = lines(file);
    for (const line of [PAGE, ...RULES]) expect(got).toContain(line);
  });

  it("3.1b writes the plain rules without the page fill, and ls-colors, for touying", () => {
    const got = lines("touying.typ");
    for (const line of RULES) expect(got).toContain(line);
    expect(got).not.toContain(PAGE);
    expect(stripped(block("touying.typ"))).toContain(stripped(
      "#let ls-colors = config-colors(primary: ls-primary, secondary: ls-accent, tertiary: ls-muted, neutral-lightest: ls-background, neutral-darkest: ls-text)",
    ));
  });

  it("3.1b writes the pop-prefixed theme update for peace-of-posters imported as pop", () => {
    const text = stripped(block("peace-of-posters.typ"));
    expect(text).toContain(stripped(
      "#pop.update-theme(heading-box-args: (fill: ls-primary, stroke: ls-primary), heading-text-args: (fill: ls-background, font: ls-heading-font), body-box-args: (fill: ls-background, stroke: ls-primary), body-text-args: (fill: ls-text, font: ls-body-font))",
    ));
    expect(lines("peace-of-posters.typ")).toContain("#set text(font: ls-body-font, fill: ls-text)");
  });

  it("3.1b writes the theme update without a prefix for a peace-of-posters import with *", () => {
    const input = [
      '#import "@preview/peace-of-posters:0.5.0": *',
      '#set page("a0", margin: 1cm)',
      "#set-poster-layout(layout-a0)",
      "#set-theme(uni-fr)",
      "",
      '#title-box("Poster title")',
      "",
    ].join("\n");
    const out = write("typst", input);
    const block = blockOf("typst", out.text);
    expect(stripped(block.text)).toContain(stripped("#update-theme(heading-box-args: (fill: ls-primary, stroke: ls-primary)"));
    expect(block.text).not.toContain("pop.");
    expect(block.from).toBeGreaterThanOrEqual(input.indexOf("#set-theme(uni-fr)\n"));
    expect(block.to).toBeLessThanOrEqual(out.text.indexOf("#title-box("));
  });

  it("3.1b writes the given colours in lower case, the quoted fonts and the scale", () => {
    const got = trimmedLines(blockOf("typst", write("typst", fixture("typst-a0.typ"), CUSTOM).text).text);
    expect(got).toContain('#let ls-primary = rgb("#123456")');
    expect(got).toContain('#let ls-accent = rgb("#abcdef")');
    expect(got).toContain('#let ls-heading-font = "Fira Sans"');
    expect(got).toContain('#let ls-body-font = "Source Serif 4"');
    expect(got).toContain('#let ls-mono-font = "Fira Code"');
    expect(got).toContain("#let ls-scale = 1.25");
  });
});
