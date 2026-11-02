// Spec 3.1: linked blocks (D5) — readDeckLinks, findLabelSource, deckLinkHash, deriveLinkState and updateDeckLink.
import { createHash } from "node:crypto";
import { parseDeck } from "../../src/decks/deckParse";
import {
  deckLinkHash,
  deriveLinkState,
  findLabelSource,
  readDeckLinks,
  updateDeckLink,
  type DeckLink,
  type DeckLinkSources,
} from "../../src/decks/deckLinks";

// The seam stubs `plan red` writes carry no imports; these globals let them compile. The real module imports its own types, which shadow these.
declare global {
  type DeckModel = import("../../src/decks/deckParse").DeckModel;
  type DeckEditResult = import("../../src/decks/deckEdit").DeckEditResult;
  type ProjectFormat = import("../../src/writing/project/projectFile").ProjectFormat;
}

const STYLE = "left: 120px; top: 80px; width: 400px; height: 200px;";

function deckHtml(slides: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>Links</title>",
    '<link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    ...slides.map((inner) => `<section data-slide>\n${inner}\n</section>`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const block = (id: string, attrs: string, inner = "<p>Text</p>"): string => `<div data-block="${id}"${attrs} style="${STYLE}">${inner}</div>`;

function modelOf(html: string): DeckModel {
  const model = parseDeck(html).model;
  if (!model) throw new Error("fixture deck does not parse");
  return model;
}

const sha12 = (content: string | Uint8Array): string => createHash("sha256").update(content).digest("hex").slice(0, 12);

function sources(over: { figures?: Record<string, Uint8Array>; labels?: Record<string, string>; cites?: Record<string, string> }): DeckLinkSources {
  return {
    readFigure: async (path) => over.figures?.[path],
    labelSource: async (label) => over.labels?.[label],
    citeText: async (key) => over.cites?.[key],
  };
}

const link = (kind: DeckLink["kind"], target: string, hash: string | null): DeckLink => ({ block: "b", slide: 0, kind, target, hash });

function expectOk(result: DeckEditResult): string {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.html;
}

// ---------------------------------------------------------------------------------------------------------------------------------

describe("readDeckLinks", () => {
  const html = deckHtml([
    [
      block("intro", ""),
      block("plot", ' data-source="figure:figures/plot.pdf" data-source-hash="3f2a9c1b7e04"'),
      block("energy", ' data-source="eq:eq:energy"', '<div data-math="display">E = mc^2</div>'),
    ].join("\n"),
    [
      block("results", ' data-source="table:tab:results" data-source-hash="3F2A9C1B7E04"'),
      block("short", ' data-source="table:tab:short" data-source-hash="3f2a9c1b7e0"'),
      block("ref", ' data-source="cite:smith2020" data-source-hash="0123456789ab"', "<p>Smith (2020).</p>"),
      block("other", ' data-source="video:clip.mp4" data-source-hash="0123456789ab"'),
      block("empty", ' data-source="figure:"'),
      block("spaced", ' data-source="figure:a b.png"'),
      block("bare", ' data-source="figures/plot.pdf"'),
    ].join("\n"),
  ]);

  it("3.1a lists figure, eq, table and cite links in source order with block, kind and target", () => {
    const links = readDeckLinks(modelOf(html));
    expect(links.map((l) => [l.block, l.kind, l.target])).toEqual([
      ["plot", "figure", "figures/plot.pdf"],
      ["energy", "eq", "eq:energy"],
      ["results", "table", "tab:results"],
      ["short", "table", "tab:short"],
      ["ref", "cite", "smith2020"],
    ]);
  });

  it("3.1a gives each link the slide of its block", () => {
    const model = modelOf(html);
    const links = readDeckLinks(model);
    const blocks = model.slides.flatMap((s) => s.blocks);
    for (const l of links) expect(l.slide).toBe(blocks.find((b) => b.id === l.block)!.slide);
    expect(links.find((l) => l.block === "plot")!.slide).not.toBe(links.find((l) => l.block === "ref")!.slide);
  });

  it("3.1a keeps a 12 lowercase hex hash and gives null when it is absent or malformed", () => {
    const byBlock = new Map(readDeckLinks(modelOf(html)).map((l) => [l.block, l.hash]));
    expect(byBlock.get("plot")).toBe("3f2a9c1b7e04");
    expect(byBlock.get("ref")).toBe("0123456789ab");
    expect(byBlock.get("energy")).toBeNull();
    expect(byBlock.get("results")).toBeNull();
    expect(byBlock.get("short")).toBeNull();
  });

  it("3.1a skips other refs, empty targets, targets with whitespace and blocks without a source", () => {
    const ids = readDeckLinks(modelOf(html)).map((l) => l.block);
    for (const id of ["intro", "other", "empty", "spaced", "bare"]) expect(ids).not.toContain(id);
  });

  it("3.1a gives an empty list for a deck without linked blocks", () => {
    expect(readDeckLinks(modelOf(deckHtml([block("a", "")])))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe("findLabelSource", () => {
  const FIGURE = [
    "\\begin{figure}[t]",
    "  \\centering",
    "  \\includegraphics[width=\\linewidth]{figures/plot.pdf}",
    "  \\caption{A plot.}",
    "  \\label{fig:plot}",
    "\\end{figure}",
  ].join("\n");
  const EQUATION = ["\\begin{equation}", "  E = mc^2", "  \\label{eq:energy}", "\\end{equation}"].join("\n");
  const MINIPAGE = ["\\begin{minipage}{0.5\\linewidth}", "    \\includegraphics{figures/a.pdf}", "    \\label{fig:inner}", "  \\end{minipage}"].join("\n");
  const TABLE = [
    "\\begin{table}",
    "  \\begin{tabular}{ll}",
    "    a & b \\\\",
    "  \\end{tabular}",
    "  \\caption{Results.}",
    "  \\label{tab:results}",
    "\\end{table}",
  ].join("\n");
  const LATEX = [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\section{Intro}\\label{sec:intro}",
    "Some text before the figure.",
    "",
    FIGURE,
    "",
    "  " + EQUATION + "   ",
    "",
    "\\begin{figure}",
    "  " + MINIPAGE,
    "\\end{figure}",
    "",
    TABLE,
    "",
    "\\begin{equation}",
    "  x = 1 % \\label{eq:ghost}",
    "\\end{equation}",
    "",
    "\\begin{equation}",
    "  y = 2",
    "  \\label{eq:energyy}",
    "\\end{equation}",
    "\\end{document}",
    "",
  ].join("\n");

  it("3.1b LaTeX gives the environment enclosing the label, from \\begin to the closing brace of \\end", () => {
    expect(findLabelSource("latex", LATEX, "fig:plot")).toBe(FIGURE);
    expect(findLabelSource("latex", LATEX, "tab:results")).toBe(TABLE);
  });

  it("3.1b LaTeX gives the source trimmed", () => {
    expect(findLabelSource("latex", LATEX, "eq:energy")).toBe(EQUATION);
  });

  it("3.1b LaTeX gives the innermost enclosing environment", () => {
    expect(findLabelSource("latex", LATEX, "fig:inner")).toBe(MINIPAGE);
  });

  it("3.1b LaTeX gives undefined for a label outside any environment", () => {
    const text = "\\section{Intro}\\label{sec:intro}\nText.\n";
    expect(findLabelSource("latex", text, "sec:intro")).toBeUndefined();
  });

  it("3.1b LaTeX gives undefined for an absent label and for a label only in a comment", () => {
    expect(findLabelSource("latex", LATEX, "fig:absent")).toBeUndefined();
    expect(findLabelSource("latex", LATEX, "eq:ghost")).toBeUndefined();
  });

  const TYPST = [
    "$ a + b $ <eq:first>",
    "",
    "= Intro",
    "",
    "Some intro text.",
    "",
    "$ E = m c^2 $ <eq:energy>",
    "",
    "#figure(",
    '  image("plot.png"),',
    "  caption: [A plot.],",
    ") <fig:plot>",
    "More text after the label.",
    "",
    "  #figure(table(columns: 2)[a][b]) <tab:results>",
    "",
  ].join("\n");

  it("3.1b Typst gives the paragraph from after the previous blank line up to and including the label", () => {
    expect(findLabelSource("typst", TYPST, "eq:energy")).toBe("$ E = m c^2 $ <eq:energy>");
    expect(findLabelSource("typst", TYPST, "fig:plot")).toBe('#figure(\n  image("plot.png"),\n  caption: [A plot.],\n) <fig:plot>');
  });

  it("3.1b Typst starts at the file start when no blank line precedes the label", () => {
    expect(findLabelSource("typst", TYPST, "eq:first")).toBe("$ a + b $ <eq:first>");
  });

  it("3.1b Typst gives the paragraph trimmed", () => {
    expect(findLabelSource("typst", TYPST, "tab:results")).toBe("#figure(table(columns: 2)[a][b]) <tab:results>");
  });

  it("3.1b Typst gives undefined for an absent label", () => {
    expect(findLabelSource("typst", TYPST, "fig:absent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe("deckLinkHash", () => {
  it("3.1c is the first 12 hex of the SHA-256 of a string's UTF-8 bytes", async () => {
    const text = "\\begin{equation}\n  E = mc^2 — é\n\\end{equation}";
    const hash = await deckLinkHash(text);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hash).toBe(sha12(text));
  });

  it("3.1c is the first 12 hex of the SHA-256 of bytes", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);
    expect(await deckLinkHash(bytes)).toBe(sha12(bytes));
  });
});

describe("deriveLinkState", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const EQ = "\\begin{equation}\n  E = mc^2\n  \\label{eq:energy}\n\\end{equation}";
  const TABLE = "#figure(table(columns: 2)[a][b]) <tab:results>";
  const CITE = "Smith, J. (2020). A study. Journal, 1(2), 3-4.";
  const src = sources({ figures: { "figures/plot.png": PNG }, labels: { "eq:energy": EQ, "tab:results": TABLE }, cites: { smith2020: CITE } });

  const cases: Array<[DeckLink["kind"], string, string | Uint8Array]> = [
    ["figure", "figures/plot.png", PNG],
    ["eq", "eq:energy", EQ],
    ["table", "tab:results", TABLE],
    ["cite", "smith2020", CITE],
  ];

  for (const [kind, target, content] of cases) {
    it(`3.1c ${kind}: fresh when the recorded hash equals the current hash`, async () => {
      const status = await deriveLinkState(link(kind, target, sha12(content)), src);
      expect(status.state).toBe("fresh");
      expect(status.hash).toBe(sha12(content));
    });

    it(`3.1c ${kind}: stale when the recorded hash differs`, async () => {
      const status = await deriveLinkState(link(kind, target, "000000000000"), src);
      expect(status.state).toBe("stale");
      expect(status.hash).toBe(sha12(content));
    });

    it(`3.1c ${kind}: stale when the link has no hash`, async () => {
      const status = await deriveLinkState(link(kind, target, null), src);
      expect(status.state).toBe("stale");
      expect(status.hash).toBe(sha12(content));
    });

    it(`3.1c ${kind}: missing when the source gives undefined`, async () => {
      const status = await deriveLinkState(link(kind, "absent-target", sha12(content)), src);
      expect(status.state).toBe("missing");
      expect(status.hash).toBeUndefined();
      expect(status.text).toBeUndefined();
    });
  }

  it("3.1c reads figures through readFigure, eq and table through labelSource and cite through citeText, by target", async () => {
    const calls: string[] = [];
    const spy: DeckLinkSources = {
      readFigure: async (path) => (calls.push(`figure ${path}`), PNG),
      labelSource: async (label) => (calls.push(`label ${label}`), EQ),
      citeText: async (key) => (calls.push(`cite ${key}`), CITE),
    };
    await deriveLinkState(link("figure", "figures/plot.png", null), spy);
    await deriveLinkState(link("eq", "eq:energy", null), spy);
    await deriveLinkState(link("table", "tab:results", null), spy);
    await deriveLinkState(link("cite", "smith2020", null), spy);
    expect(calls).toEqual(["figure figures/plot.png", "label eq:energy", "label tab:results", "cite smith2020"]);
  });

  it("3.1c gives the cite text for cite links and no text for other kinds", async () => {
    expect((await deriveLinkState(link("cite", "smith2020", null), src)).text).toBe(CITE);
    expect((await deriveLinkState(link("cite", "smith2020", sha12(CITE)), src)).text).toBe(CITE);
    expect((await deriveLinkState(link("eq", "eq:energy", null), src)).text).toBeUndefined();
    expect((await deriveLinkState(link("figure", "figures/plot.png", null), src)).text).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe("updateDeckLink", () => {
  const NEW = "a1b2c3d4e5f6";
  const html = deckHtml([
    [
      block("plot", ' data-source="figure:figures/plot.pdf" data-source-hash="3f2a9c1b7e04"', '<img src="assets/plot.png" alt="Plot">'),
      block("energy", ' data-source="eq:eq:energy"', '<div data-math="display">E = mc^2</div>'),
      block("bad", ' data-source="table:tab:results" data-source-hash="nothex"'),
      block("plain", "", "<p>No source.</p>"),
    ].join("\n"),
    [
      block("ref", ' data-source="cite:smith2020" data-source-hash="0123456789ab"', "<p>Smith (2019).</p><p>Second leaf.</p>"),
      block("newref", ' data-source="cite:doe2021"', "<p>Doe (2020).</p>"),
      block("emptyref", ' data-source="cite:lee2022" data-source-hash="0123456789ab"', '<img src="assets/plot.png" alt="">'),
    ].join("\n"),
  ]);

  it("3.1d rewrites an existing hash and keeps every other byte", () => {
    const out = expectOk(updateDeckLink(html, "plot", NEW));
    expect(out).toBe(html.replace('data-source-hash="3f2a9c1b7e04"', `data-source-hash="${NEW}"`));
  });

  it("3.1d rewrites a malformed hash value in place", () => {
    const out = expectOk(updateDeckLink(html, "bad", NEW));
    expect(out).toBe(html.replace('data-source-hash="nothex"', `data-source-hash="${NEW}"`));
  });

  it("3.1d inserts the hash right after the data-source attribute when absent", () => {
    const out = expectOk(updateDeckLink(html, "energy", NEW));
    expect(out).toBe(html.replace('data-source="eq:eq:energy"', `data-source="eq:eq:energy" data-source-hash="${NEW}"`));
  });

  it("3.1d with text rewrites a cite block's hash and its first leaf only", () => {
    const out = expectOk(updateDeckLink(html, "ref", NEW, "Smith (2020)."));
    const expected = html
      .replace('data-source="cite:smith2020" data-source-hash="0123456789ab"', `data-source="cite:smith2020" data-source-hash="${NEW}"`)
      .replace("<p>Smith (2019).</p><p>Second leaf.</p>", "<p>Smith (2020).</p><p>Second leaf.</p>");
    expect(out).toBe(expected);
  });

  it("3.1d with text inserts the hash and sets the text of a cite block without a hash", () => {
    const out = expectOk(updateDeckLink(html, "newref", NEW, "Doe (2021)."));
    const expected = html
      .replace('data-source="cite:doe2021"', `data-source="cite:doe2021" data-source-hash="${NEW}"`)
      .replace("<p>Doe (2020).</p>", "<p>Doe (2021).</p>");
    expect(out).toBe(expected);
  });

  it("3.1d ignores text for a non-cite block", () => {
    const out = expectOk(updateDeckLink(html, "energy", NEW, "Ignored text"));
    expect(out).toBe(html.replace('data-source="eq:eq:energy"', `data-source="eq:eq:energy" data-source-hash="${NEW}"`));
  });

  it("3.1d gives {ok: false} for an unknown block", () => {
    expect(updateDeckLink(html, "nope", NEW).ok).toBe(false);
  });

  it("3.1d gives {ok: false} for a block without data-source", () => {
    expect(updateDeckLink(html, "plain", NEW).ok).toBe(false);
  });

  it("3.1d gives {ok: false} for a hash that is not 12 lowercase hex", () => {
    for (const bad of ["A1B2C3D4E5F6", "a1b2c3d4e5f", "a1b2c3d4e5f67", "g1b2c3d4e5f6", "", "a1b2c3d4e5f\""]) {
      expect(updateDeckLink(html, "plot", bad).ok).toBe(false);
    }
  });

  it("3.1d gives {ok: false} for text on a cite block without a leaf", () => {
    expect(updateDeckLink(html, "emptyref", NEW, "Lee (2022).").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe("linked blocks end to end", () => {
  it("A9 figure, equation and citation blocks show stale after the source changes and fresh after updateDeckLink", async () => {
    const manuscript = (eq: string) => `\\begin{document}\n\\begin{equation}\n  ${eq}\n  \\label{eq:energy}\n\\end{equation}\n\\end{document}\n`;
    let figure = new Uint8Array([1, 2, 3, 4]);
    let tex = manuscript("E = mc^2");
    let cite = "Smith, J. (2019). Old title.";
    const live: DeckLinkSources = {
      readFigure: async (path) => (path === "figures/plot.png" ? figure : undefined),
      labelSource: async (label) => findLabelSource("latex", tex, label),
      citeText: async (key) => (key === "smith2020" ? cite : undefined),
    };

    let html = deckHtml([
      [
        block("plot", ` data-source="figure:figures/plot.png" data-source-hash="${await deckLinkHash(figure)}"`, '<img src="assets/plot.png" alt="Plot">'),
        block("energy", ` data-source="eq:eq:energy" data-source-hash="${await deckLinkHash(findLabelSource("latex", tex, "eq:energy")!)}"`, '<div data-math="display">E = mc^2</div>'),
        block("ref", ` data-source="cite:smith2020" data-source-hash="${await deckLinkHash(cite)}"`, `<p>${cite}</p>`),
      ].join("\n"),
    ]);
    const states = async () => {
      const links = readDeckLinks(modelOf(html));
      const out: Record<string, { state: string; hash?: string; text?: string }> = {};
      for (const l of links) out[l.block] = await deriveLinkState(l, live);
      return out;
    };

    const before = await states();
    expect(Object.keys(before).sort()).toEqual(["energy", "plot", "ref"]);
    for (const id of ["plot", "energy", "ref"]) expect(before[id]!.state).toBe("fresh");

    figure = new Uint8Array([1, 2, 3, 5]);
    tex = manuscript("E = m c^{2} + k");
    cite = "Smith, J. (2020). New title.";
    const changed = await states();
    for (const id of ["plot", "energy", "ref"]) expect(changed[id]!.state).toBe("stale");

    for (const id of ["plot", "energy", "ref"]) {
      html = expectOk(updateDeckLink(html, id, changed[id]!.hash!, changed[id]!.text));
    }
    const after = await states();
    for (const id of ["plot", "energy", "ref"]) expect(after[id]!.state).toBe("fresh");
    const refBlock = modelOf(html).slides[0]!.blocks.find((b) => b.id === "ref")!;
    expect(refBlock.leaves[0]!.text).toBe("Smith, J. (2020). New title.");
  });
});
