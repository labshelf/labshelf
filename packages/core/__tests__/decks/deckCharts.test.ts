// Spec 9.2 (pure part): the chart block of an HTML deck. chartBlockHtml/readDeckChart round trip, setDeckChart, the refused png and oversize model,
// describeDeckBlock's chart kind and label, applyDeckEdit setChart and the DECK025 warning of validateDeck.
// Written as if the file sat at packages/core/__tests__/decks/deckCharts.test.ts; relative imports are resolved from there.
import { describeDeckBlock, imageBlockHtml, textBlockHtml } from "../../src/decks/deckBlocks.js";
import { DECK_CHART_MODEL_LIMIT, chartBlockHtml, readDeckChart, setDeckChart, type DeckChart } from "../../src/decks/deckCharts.js";
import { applyDeckEdit } from "../../src/decks/deckEdit.js";
import { parseDeck, type DeckBlock } from "../../src/decks/deckParse.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { TALK_OPTIONS, talk } from "./deckSamples.js";

const rect = { left: 120, top: 80, width: 400, height: 200 };
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PNG_2 = "data:image/png;base64,AAAAAAAA";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";
const TOO_LARGE = "Chart data is too large (keep it under 128 KB)";

const modelText = (extra: Record<string, unknown> = {}): string => JSON.stringify({ v: 1, title: "Growth", series: [{ x: [1, 2], y: [3, 4] }], ...extra });
const chart = (overrides: Partial<DeckChart> = {}): DeckChart => ({ model: modelText(), png: PNG, alt: "Growth chart", ...overrides });

const blocksOf = (html: string): DeckBlock[] => parseDeck(html).model!.slides[0]!.blocks;
const blockOf = (html: string, id: string): DeckBlock => blocksOf(html).find((block) => block.id === id)!;
const deckWith = (...blocks: string[]): string => talk(blocks.join("\n"));
const must = (result: { ok: boolean; html?: string; error?: string }): string => {
  if (!result.ok) throw new Error(result.error);
  return result.html!;
};
const chartAttribute = (html: string): string | undefined => /data-chart="([^"]*)"/.exec(html)?.[1];
const sizedModel = (length: number): string => {
  const head = '{"v":1,"pad":"';
  const tail = '"}';
  return head + "x".repeat(length - head.length - tail.length) + tail;
};

describe("chartBlockHtml and readDeckChart", () => {
  it("9.2a chartBlockHtml writes the block id, data-chart, the rect style and an img with the png and alt", () => {
    const html = chartBlockHtml("chart-1", rect, chart());
    expect(html).toContain('data-block="chart-1"');
    expect(html).toContain("data-chart=");
    expect(html).toContain("left: 120px; top: 80px; width: 400px; height: 200px;");
    expect(html).toContain(`<img src="${PNG}" alt="Growth chart" style="width: 100%; height: 100%; object-fit: contain;">`);
  });

  it("9.2a chartBlockHtml parses as one block with the rect and no parse problems", () => {
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart()));
    expect(parseDeck(deck).problems).toEqual([]);
    expect(blocksOf(deck).map((block) => block.id)).toEqual(["chart-1"]);
    expect(blocksOf(deck)[0]!.rect).toEqual(rect);
  });

  it("9.2a readDeckChart returns the model text and the png written by chartBlockHtml", () => {
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart()));
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))).toEqual({ model: modelText(), png: PNG });
  });

  it("9.2a the model is attribute-escaped and read back unescaped when it holds & \" < >", () => {
    const model = modelText({ title: 'A & "B" <c> d', note: "x > y && y < z" });
    const html = chartBlockHtml("chart-1", rect, chart({ model }));
    const attribute = chartAttribute(html)!;
    expect(attribute).toBeDefined();
    expect(attribute).not.toMatch(/[<>"]/);
    expect(attribute).toContain("&quot;");
    expect(attribute).toContain("&lt;");
    expect(attribute).toContain("&gt;");
    expect(attribute).toContain("&amp;");
    const deck = deckWith(html);
    expect(parseDeck(deck).problems).toEqual([]);
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))).toEqual({ model, png: PNG });
  });

  it("9.2a the alt is escaped in the attribute and the block still parses", () => {
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart({ alt: 'Sales "Q1" <up> & down' })));
    expect(parseDeck(deck).problems).toEqual([]);
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))).toEqual({ model: modelText(), png: PNG });
  });

  it("9.2a an svg data url is accepted as the image", () => {
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart({ png: SVG })));
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))).toEqual({ model: modelText(), png: SVG });
  });

  it("9.2a readDeckChart returns null for a block without data-chart", () => {
    const deck = deckWith(textBlockHtml("title", rect, "Hello"), imageBlockHtml("pic", rect, "assets/a.png"));
    expect(readDeckChart(deck, blockOf(deck, "title"))).toBeNull();
    expect(readDeckChart(deck, blockOf(deck, "pic"))).toBeNull();
  });

  it("9.2a readDeckChart gives a null png when the chart block has no img", () => {
    const deck = deckWith(`<div data-block="chart-1" data-chart="${"{&quot;v&quot;:1}"}" style="left: 120px; top: 80px; width: 400px; height: 200px;"><p>No picture</p></div>`);
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))).toEqual({ model: '{"v":1}', png: null });
  });

  it("9.2a readDeckChart reads the right block when several are in the deck", () => {
    const other = chart({ model: modelText({ title: "Other" }), png: PNG_2 });
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart()), chartBlockHtml("chart-2", { ...rect, top: 400 }, other));
    expect(readDeckChart(deck, blockOf(deck, "chart-2"))).toEqual({ model: other.model, png: PNG_2 });
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))).toEqual({ model: modelText(), png: PNG });
  });
});

describe("chartBlockHtml refusals", () => {
  it.each([
    ["a file path", "assets/chart.png"],
    ["a jpeg data url", "data:image/jpeg;base64,AAAA"],
    ["a gif data url", "data:image/gif;base64,AAAA"],
    ["an http url", "https://example.com/chart.png"],
    ["an empty string", ""],
  ])("9.2a chartBlockHtml throws for %s as the png", (_name, png) => {
    expect(() => chartBlockHtml("chart-1", rect, chart({ png }))).toThrow();
  });

  it("9.2a chartBlockHtml throws the too-large message for a model over the limit", () => {
    expect(DECK_CHART_MODEL_LIMIT).toBe(131072);
    expect(() => chartBlockHtml("chart-1", rect, chart({ model: sizedModel(DECK_CHART_MODEL_LIMIT + 1) }))).toThrow(TOO_LARGE);
  });

  it("9.2a chartBlockHtml accepts a model of exactly the limit", () => {
    const model = sizedModel(DECK_CHART_MODEL_LIMIT);
    expect(model).toHaveLength(DECK_CHART_MODEL_LIMIT);
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart({ model })));
    expect(readDeckChart(deck, blockOf(deck, "chart-1"))!.model).toBe(model);
  });
});

describe("setDeckChart", () => {
  const first = chartBlockHtml("chart-1", rect, chart());
  const deck = deckWith(textBlockHtml("title", rect, "Hello"), first, imageBlockHtml("pic", { ...rect, top: 400 }, "assets/a.png"));
  const next = chart({ model: modelText({ title: "Decline", series: [] }), png: PNG_2, alt: "Decline chart" });

  it("9.2a setDeckChart replaces the model, the src and the alt", () => {
    const edited = must(setDeckChart(deck, "chart-1", next));
    expect(readDeckChart(edited, blockOf(edited, "chart-1"))).toEqual({ model: next.model, png: PNG_2 });
    expect(edited).toContain('alt="Decline chart"');
    expect(edited).not.toContain('alt="Growth chart"');
    expect(edited).not.toContain(PNG);
  });

  it("9.2a setDeckChart keeps every other byte", () => {
    const edited = must(setDeckChart(deck, "chart-1", next));
    const expected = deck.replace(chartBlockHtml("chart-1", rect, chart()), chartBlockHtml("chart-1", rect, next));
    expect(edited).toBe(expected);
  });

  it("9.2a setDeckChart with the same chart leaves the deck unchanged", () => {
    expect(must(setDeckChart(deck, "chart-1", chart()))).toBe(deck);
  });

  it("9.2a setDeckChart keeps the block's rect and the other blocks", () => {
    const edited = must(setDeckChart(deck, "chart-1", next));
    expect(parseDeck(edited).problems).toEqual([]);
    expect(blocksOf(edited).map((block) => [block.id, block.rect])).toEqual(blocksOf(deck).map((block) => [block.id, block.rect]));
  });

  it("9.2a setDeckChart changes only the chart block when two charts exist", () => {
    const two = deckWith(first, chartBlockHtml("chart-2", { ...rect, top: 400 }, chart({ png: PNG_2 })));
    const edited = must(setDeckChart(two, "chart-2", next));
    expect(readDeckChart(edited, blockOf(edited, "chart-1"))).toEqual({ model: modelText(), png: PNG });
    expect(readDeckChart(edited, blockOf(edited, "chart-2"))).toEqual({ model: next.model, png: PNG_2 });
  });

  it("9.2a setDeckChart gives an error result for an unknown id", () => {
    const result = setDeckChart(deck, "nope", next);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("9.2a setDeckChart gives an error result for a block without data-chart", () => {
    expect(setDeckChart(deck, "pic", next).ok).toBe(false);
    expect(setDeckChart(deck, "title", next).ok).toBe(false);
  });

  it("9.2a setDeckChart refuses a png that is not a png or svg data url", () => {
    for (const png of ["assets/chart.png", "data:image/jpeg;base64,AAAA", ""]) {
      expect(setDeckChart(deck, "chart-1", chart({ png })).ok).toBe(false);
    }
  });

  it("9.2a setDeckChart refuses an oversize model with the too-large error", () => {
    const result = setDeckChart(deck, "chart-1", chart({ model: sizedModel(DECK_CHART_MODEL_LIMIT + 1) }));
    expect(result).toEqual({ ok: false, error: TOO_LARGE });
  });

  it("9.2a setDeckChart does not throw on a refused chart", () => {
    expect(() => setDeckChart(deck, "chart-1", chart({ png: "x" }))).not.toThrow();
  });
});

describe("describeDeckBlock for a chart", () => {
  const describe_ = (model: string): { kind: string; label: string } => {
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart({ model })));
    return describeDeckBlock(deck, blockOf(deck, "chart-1"));
  };

  it("9.2b a chart block is kind chart, not image, labelled with the model title", () => {
    expect(describe_(modelText({ title: "Growth" }))).toEqual({ kind: "chart", label: "Growth" });
  });

  it("9.2b the label is the unescaped title", () => {
    expect(describe_(modelText({ title: 'A & "B" <c>' }))).toEqual({ kind: "chart", label: 'A & "B" <c>' });
  });

  it("9.2b an empty title gives the label Chart", () => {
    expect(describe_(modelText({ title: "" }))).toEqual({ kind: "chart", label: "Chart" });
  });

  it("9.2b a missing title gives the label Chart", () => {
    expect(describe_(JSON.stringify({ v: 1 }))).toEqual({ kind: "chart", label: "Chart" });
  });

  it("9.2b a title that is not a string gives the label Chart", () => {
    expect(describe_(modelText({ title: 42 }))).toEqual({ kind: "chart", label: "Chart" });
  });

  it("9.2b unreadable JSON gives kind chart with the label Chart", () => {
    expect(describe_("not json {")).toEqual({ kind: "chart", label: "Chart" });
  });

  it("9.2b plain image, text blocks keep their kinds next to a chart", () => {
    const deck = deckWith(chartBlockHtml("chart-1", rect, chart()), imageBlockHtml("pic", rect, "assets/a.png"), textBlockHtml("title", rect, "Hello"));
    expect(blocksOf(deck).map((block) => describeDeckBlock(deck, block))).toEqual([
      { kind: "chart", label: "Growth" }, { kind: "image", label: "Image" }, { kind: "text", label: "Hello" },
    ]);
  });
});

describe("applyDeckEdit setChart", () => {
  const deck = deckWith(textBlockHtml("title", rect, "Hello"), chartBlockHtml("chart-1", rect, chart()));
  const next = chart({ model: modelText({ title: "Decline" }), png: PNG_2, alt: "Decline chart" });

  it("9.2b setChart gives the same deck as setDeckChart", () => {
    expect(applyDeckEdit(deck, { kind: "setChart", block: "chart-1", chart: next })).toEqual(setDeckChart(deck, "chart-1", next));
  });

  it("9.2b setChart replaces the model, png and alt of the block", () => {
    const edited = must(applyDeckEdit(deck, { kind: "setChart", block: "chart-1", chart: next }));
    expect(readDeckChart(edited, blockOf(edited, "chart-1"))).toEqual({ model: next.model, png: PNG_2 });
    expect(edited).toContain('alt="Decline chart"');
  });

  it("9.2b setChart on an unknown block gives an error result", () => {
    expect(applyDeckEdit(deck, { kind: "setChart", block: "nope", chart: next }).ok).toBe(false);
  });

  it("9.2b setChart on a block without data-chart gives an error result", () => {
    expect(applyDeckEdit(deck, { kind: "setChart", block: "title", chart: next }).ok).toBe(false);
  });

  it("9.2b setChart with an oversize model gives the too-large error without throwing", () => {
    const edit = { kind: "setChart" as const, block: "chart-1", chart: chart({ model: sizedModel(DECK_CHART_MODEL_LIMIT + 1) }) };
    expect(applyDeckEdit(deck, edit)).toEqual({ ok: false, error: TOO_LARGE });
  });

  it("9.2b the edited deck still validates without errors", () => {
    const edited = must(applyDeckEdit(deck, { kind: "setChart", block: "chart-1", chart: next }));
    expect(validateDeck(edited, TALK_OPTIONS).filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("validateDeck DECK025", () => {
  const validate = (model: string) => validateDeck(talk(chartBlockHtml("chart-1", rect, chart({ model }))), TALK_OPTIONS);
  const deck025 = (model: string) => validate(model).filter((d) => d.code === "DECK025");

  it("9.2b a deck with a readable chart is clean", () => {
    expect(validate(modelText())).toEqual([]);
  });

  it("9.2b DECK025 warns for data-chart that is not JSON, naming the block and slide", () => {
    const found = deck025("not json {");
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(expect.objectContaining({
      code: "DECK025", severity: "warning", block: "chart-1", slide: 0,
      message: "Chart data cannot be read; the chart shows its image but cannot be edited",
    }));
    expect(found[0]!.line).toBeGreaterThanOrEqual(1);
    expect(found[0]!.column).toBeGreaterThanOrEqual(1);
    expect(found[0]!.hint.length).toBeGreaterThan(0);
  });

  it("9.2b DECK025 warns for JSON that is not an object", () => {
    expect(deck025("[1,2,3]")).toHaveLength(1);
    expect(deck025("42")).toHaveLength(1);
    expect(deck025("null")).toHaveLength(1);
  });

  it("9.2b DECK025 warns for an object whose v is not 1", () => {
    expect(deck025(JSON.stringify({ v: 2, title: "x" }))).toHaveLength(1);
    expect(deck025(JSON.stringify({ title: "x" }))).toHaveLength(1);
    expect(deck025(JSON.stringify({ v: "1" }))).toHaveLength(1);
  });

  it("9.2b DECK025 is only a warning, so the deck has no errors", () => {
    expect(validate("not json {").filter((d) => d.severity === "error")).toEqual([]);
  });

  it("9.2b DECK025 is listed among the rules as a warning", async () => {
    const { listDeckRules } = await import("../../src/decks/deckValidate.js");
    expect(listDeckRules().find((rule) => rule.code === "DECK025")).toEqual(expect.objectContaining({ code: "DECK025", severity: "warning" }));
  });

  it("9.2b DECK025 is not reported for a block without data-chart", () => {
    const deck = talk(`${imageBlockHtml("pic", rect, "assets/plot.png")}\n${textBlockHtml("title", { ...rect, top: 400 }, "Hello")}`);
    expect(validateDeck(deck, TALK_OPTIONS).filter((d) => d.code === "DECK025")).toEqual([]);
  });
});
