import { parseDeck } from "../../src/decks/deckParse";

// The seam stubs `plan red` writes carry no imports; these globals let them compile. The real modules import their own types, which shadow these.
declare global {
  interface DeckRange {
    from: number;
    to: number;
  }
  interface DeckParseProblem {
    message: string;
    offset: number;
    line: number;
    column: number;
  }
  interface DeckSize {
    w: number;
    h: number;
    unit: "px" | "mm" | "in";
  }
  type DeckKind = "talk" | "poster";
}

interface Range {
  from: number;
  to: number;
}

const slice = (text: string, range: Range | null | undefined): string | undefined =>
  range ? text.slice(range.from, range.to) : undefined;

/** Independent 1-based line and column of an offset (\r\n is one break; a line starts after \n). */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      start = i + 1;
    }
  }
  return { line, column: offset - start + 1 };
}

/** Wraps body content in a valid talk document. */
const talk = (body: string): string =>
  [
    "<!doctype html>",
    '<html data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    '<head><link rel="stylesheet" href="theme.css" data-deck-theme></head>',
    `<body>${body}</body>`,
    "</html>",
  ].join("\n");

const BOX = 'style="left: 0px; top: 0px; width: 100px; height: 100px"';

// Sample talk, built from parts so the expected slices are known exactly.
const LINK = '<link rel="stylesheet" href="theme.css" data-deck-theme>';
const TITLE_STYLE = "left: 80px; top: 60px; width: 1760px; height: 200px; color: red";
const TITLE_START = `<div data-block="title" style="${TITLE_STYLE}">`;
const TITLE_INNER = "\n<h1>Hello &amp; welcome</h1>\n";
const TITLE_BLOCK = `${TITLE_START}${TITLE_INNER}</div>`;
const BODY_STYLE = "left:80px;top:300px;width:800.5px;height:400.25px";
const BODY_START = `<div data-block="body" style="${BODY_STYLE}">`;
const BODY_BLOCK = `${BODY_START}\n<p>First<br>second</p>\n</div>`;
const SLIDE1_INNER = `\n${TITLE_BLOCK}\n${BODY_BLOCK}\n`;
const SLIDE1 = `<section data-slide>${SLIDE1_INNER}</section>`;
const PIC_STYLE = "left: 0px; top: 0px; width: 10em; height: 100px";
const PIC_START = `<div data-block="pic" style="${PIC_STYLE}">`;
const PIC_BLOCK = `${PIC_START}<img src="assets/a.png" alt=""></div>`;
const SLIDE2_INNER = `\n${PIC_BLOCK}\n`;
const SLIDE2 = `<section data-slide>${SLIDE2_INNER}</section>`;
const BODY_INNER = `\n${SLIDE1}\n${SLIDE2}\n`;
const SAMPLE = [
  "<!doctype html>",
  '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
  "<head>",
  '<meta charset="utf-8">',
  "<title>Demo <b> & talk</title>",
  "<style>p > a { color: red; }</style>",
  LINK,
  "</head>",
  `<body>${BODY_INNER}</body>`,
  "</html>",
  "",
].join("\n");

describe("parseDeck on a sample talk", () => {
  it("1.2c reads a valid sample without problems", () => {
    const result = parseDeck(SAMPLE);
    expect(result.problems).toEqual([]);
    expect(result.model).toBeDefined();
  });

  it("1.2c reads kind, version and size from the html element", () => {
    const model = parseDeck(SAMPLE).model!;
    expect(model.kind).toBe("talk");
    expect(model.version).toBe("1");
    expect(model.size).toEqual({ w: 1920, h: 1080, unit: "px" });
    expect(slice(SAMPLE, model.sizeRange)).toBe("1920x1080px");
  });

  it("1.2c gives the theme link range", () => {
    const model = parseDeck(SAMPLE).model!;
    expect(slice(SAMPLE, model.themeLink)).toBe(LINK);
  });

  it("1.2c gives the body content range", () => {
    const model = parseDeck(SAMPLE).model!;
    expect(slice(SAMPLE, model.bodyContentRange)).toBe(BODY_INNER);
  });

  it("1.2c lists the slides with their ranges", () => {
    const model = parseDeck(SAMPLE).model!;
    expect(model.slides.map((s) => s.index)).toEqual([0, 1]);
    expect(slice(SAMPLE, model.slides[0]!.range)).toBe(SLIDE1);
    expect(slice(SAMPLE, model.slides[0]!.contentRange)).toBe(SLIDE1_INNER);
    expect(slice(SAMPLE, model.slides[1]!.range)).toBe(SLIDE2);
    expect(slice(SAMPLE, model.slides[1]!.contentRange)).toBe(SLIDE2_INNER);
    expect(model.slides[0]!.notes).toBeUndefined();
  });

  it("1.2c lists the blocks of each slide in source order with their slide index", () => {
    const model = parseDeck(SAMPLE).model!;
    expect(model.slides[0]!.blocks.map((b) => [b.id, b.slide])).toEqual([
      ["title", 0],
      ["body", 0],
    ]);
    expect(model.slides[1]!.blocks.map((b) => [b.id, b.slide])).toEqual([["pic", 1]]);
  });

  it("1.2c gives block range, start tag and style ranges", () => {
    const all = parseDeck(SAMPLE).model!.slides[0]!.blocks;
    const title = all[0]!;
    const body = all[1]!;
    expect(slice(SAMPLE, title.range)).toBe(TITLE_BLOCK);
    expect(slice(SAMPLE, title.startTag)).toBe(TITLE_START);
    expect(slice(SAMPLE, title.styleRange)).toBe(TITLE_STYLE);
    expect(slice(SAMPLE, body.range)).toBe(BODY_BLOCK);
    expect(slice(SAMPLE, body.startTag)).toBe(BODY_START);
    expect(slice(SAMPLE, body.styleRange)).toBe(BODY_STYLE);
  });

  it("1.2c reads the block rect", () => {
    const all = parseDeck(SAMPLE).model!.slides[0]!.blocks;
    const title = all[0]!;
    const body = all[1]!;
    expect(title.rect).toEqual({ left: 80, top: 60, width: 1760, height: 200 });
    expect(body.rect).toEqual({ left: 80, top: 300, width: 800.5, height: 400.25 });
  });

  it("1.2c gives trimmed value ranges of the rect declarations", () => {
    const all = parseDeck(SAMPLE).model!.slides[0]!.blocks;
    const title = all[0]!;
    const body = all[1]!;
    expect(slice(SAMPLE, title.rectRanges.left)).toBe("80px");
    expect(slice(SAMPLE, title.rectRanges.top)).toBe("60px");
    expect(slice(SAMPLE, title.rectRanges.width)).toBe("1760px");
    expect(slice(SAMPLE, title.rectRanges.height)).toBe("200px");
    expect(slice(SAMPLE, body.rectRanges.width)).toBe("800.5px");
    expect(slice(SAMPLE, body.rectRanges.height)).toBe("400.25px");
  });

  it("1.2c leaves rect null when a value is not px but keeps its range", () => {
    const all = parseDeck(SAMPLE).model!.slides[1]!.blocks;
    const pic = all[0]!;
    expect(pic.rect).toBeNull();
    expect(slice(SAMPLE, pic.rectRanges.width)).toBe("10em");
    expect(slice(SAMPLE, pic.rectRanges.height)).toBe("100px");
  });

  it("1.2c gives null kind, version, size and theme link when the attributes are wrong or absent", () => {
    const html = [
      '<html data-deck="slides" data-deck-size="1920x1080">',
      '<head><link rel="stylesheet" href="theme.css"></head>',
      "<body></body>",
      "</html>",
    ].join("\n");
    const model = parseDeck(html).model!;
    expect(model.kind).toBeNull();
    expect(model.version).toBeNull();
    expect(model.size).toBeNull();
    expect(slice(html, model.sizeRange)).toBe("1920x1080");
    expect(model.themeLink).toBeNull();
    expect(model.slides).toEqual([]);
  });

  it("1.2c reads a poster kind and size", () => {
    const html = '<html data-deck="poster" data-deck-size="841x1189mm"><head></head><body></body></html>';
    const model = parseDeck(html).model!;
    expect(model.kind).toBe("poster");
    expect(model.size).toEqual({ w: 841, h: 1189, unit: "mm" });
  });

  it("1.2c gives a null styleRange and rect for a block without style", () => {
    const html = talk('<section data-slide><div data-block="a"></div></section>');
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.id).toBe("a");
    expect(block.styleRange).toBeNull();
    expect(block.rect).toBeNull();
  });

  it("1.2c counts the last declaration of a rect property", () => {
    const style = "left: 1px; top: 2px; width: 3px; height: 4px; left: 5px";
    const html = talk(`<section data-slide><div data-block="a" style="${style}"></div></section>`);
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.rect).toEqual({ left: 5, top: 2, width: 3, height: 4 });
    expect(block.rectRanges.left!.from).toBe(html.indexOf("5px"));
    expect(slice(html, block.rectRanges.left)).toBe("5px");
  });

  it("1.2c compares property names lowercase", () => {
    const style = "LEFT: 1px; Top: 2px; WIDTH: 3px; height: 4px";
    const html = talk(`<section data-slide><div data-block="a" style="${style}"></div></section>`);
    expect(parseDeck(html).model!.slides[0]!.blocks[0]!.rect).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it("1.2c splits declarations outside parentheses and quotes", () => {
    const style = "background: url(a;left:9px); font-family: 'x;top:9px'; left: 1px; top: 2px; width: 3px; height: 4px";
    const html = talk(`<section data-slide><div data-block="a" style="${style}"></div></section>`);
    expect(parseDeck(html).model!.slides[0]!.blocks[0]!.rect).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it("1.2c allows negative left and top but not negative width or height", () => {
    const ok = talk('<section data-slide><div data-block="a" style="left: -10px; top: -2.5px; width: 3px; height: 4px"></div></section>');
    expect(parseDeck(ok).model!.slides[0]!.blocks[0]!.rect).toEqual({ left: -10, top: -2.5, width: 3, height: 4 });
    const bad = talk('<section data-slide><div data-block="a" style="left: 1px; top: 2px; width: -3px; height: 4px"></div></section>');
    expect(parseDeck(bad).model!.slides[0]!.blocks[0]!.rect).toBeNull();
  });

  it("1.2c leaves rect null for more than 2 decimals or a missing property", () => {
    const decimals = talk('<section data-slide><div data-block="a" style="left: 1.123px; top: 2px; width: 3px; height: 4px"></div></section>');
    expect(parseDeck(decimals).model!.slides[0]!.blocks[0]!.rect).toBeNull();
    const missing = talk('<section data-slide><div data-block="a" style="left: 1px; top: 2px; width: 3px"></div></section>');
    const block = parseDeck(missing).model!.slides[0]!.blocks[0]!;
    expect(block.rect).toBeNull();
    expect(block.rectRanges.height).toBeUndefined();
  });
});

describe("parseDeck leaves, notes and sources", () => {
  it("1.2d finds a text leaf with its ranges and decoded text", () => {
    const all = parseDeck(SAMPLE).model!.slides[0]!.blocks;
    const title = all[0]!;
    expect(title.leaves).toHaveLength(1);
    expect(slice(SAMPLE, title.leaves[0]!.range)).toBe("<h1>Hello &amp; welcome</h1>");
    expect(slice(SAMPLE, title.leaves[0]!.contentRange)).toBe("Hello &amp; welcome");
    expect(title.leaves[0]!.text).toBe("Hello & welcome");
    expect(title.leaves[0]!.math).toBeUndefined();
  });

  it("1.2d writes br as a newline in leaf text", () => {
    const all = parseDeck(SAMPLE).model!.slides[0]!.blocks;
    const body = all[1]!;
    expect(body.leaves.map((l) => l.text)).toEqual(["First\nsecond"]);
  });

  it("1.2d does not treat a block or an element holding non-phrasing children as a leaf", () => {
    const html = talk(
      `<section data-slide><div data-block="plain" ${BOX}>plain text</div>` +
        `<div data-block="nest" ${BOX}><div class="c"><p>A <em>b</em></p><p>C</p></div></div></section>`,
    );
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const plain = all[0]!;
    const nest = all[1]!;
    expect(plain.leaves).toEqual([]);
    expect(nest.leaves.map((l) => slice(html, l.range))).toEqual(["<p>A <em>b</em></p>", "<p>C</p>"]);
    expect(nest.leaves.map((l) => l.text)).toEqual(["A b", "C"]);
  });

  it("1.2d treats an empty non-void element as a leaf but not a void one", () => {
    const html = talk(`<section data-slide><div data-block="a" ${BOX}><p></p><img src="assets/x.png"></div></section>`);
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.leaves.map((l) => slice(html, l.range))).toEqual(["<p></p>"]);
    expect(block.leaves[0]!.text).toBe("");
    expect(slice(html, block.leaves[0]!.contentRange)).toBe("");
  });

  it("1.2d decodes named and numeric references and keeps unknown ones", () => {
    const html = talk(`<section data-slide><div data-block="a" ${BOX}><p>&lt;a&gt; &quot;&apos; &#65;&#x42; &foo; &nbsp;x</p></div></section>`);
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.leaves[0]!.text).toBe("<a> \"' AB &foo;  x");
  });

  it("1.2d finds inline and display math leaves with their TeX source", () => {
    const html = talk(
      `<section data-slide><div data-block="a" ${BOX}>` +
        "<span data-math>x^2</span>" +
        '<div data-math="display">\\int_0^1 x\\,dx</div>' +
        "</div></section>",
    );
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.leaves.map((l) => [l.math, l.text])).toEqual([
      ["inline", "x^2"],
      ["display", "\\int_0^1 x\\,dx"],
    ]);
    expect(slice(html, block.leaves[0]!.range)).toBe("<span data-math>x^2</span>");
    expect(slice(html, block.leaves[0]!.contentRange)).toBe("x^2");
  });

  it("1.2d treats a paragraph holding math as one leaf with the TeX in its text", () => {
    const html = talk(`<section data-slide><div data-block="a" ${BOX}><p>Energy <span data-math>E=mc^2</span> holds</p></div></section>`);
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.leaves).toHaveLength(1);
    expect(block.leaves[0]!.math).toBeUndefined();
    expect(block.leaves[0]!.text).toBe("Energy E=mc^2 holds");
  });

  it("1.2d finds the first notes aside of a slide", () => {
    const notes = '<aside data-notes>Say &quot;hi&quot; first</aside>';
    const html = talk(`<section data-slide><div data-block="a" ${BOX}></div>${notes}<aside data-notes>second</aside></section>`);
    const slide = parseDeck(html).model!.slides[0]!;
    expect(slide.notes).toBeDefined();
    expect(slice(html, slide.notes!.range)).toBe(notes);
    expect(slice(html, slide.notes!.contentRange)).toBe("Say &quot;hi&quot; first");
    expect(slide.notes!.text).toBe('Say "hi" first');
    expect(slide.blocks.map((b) => b.id)).toEqual(["a"]);
  });

  it("1.2d reads data-source and data-source-hash with their value ranges", () => {
    const html = talk(
      `<section data-slide><div data-block="fig" data-source="figure:figures/plot.pdf" data-source-hash="0123456789ab" ${BOX}></div></section>`,
    );
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.source).toBeDefined();
    expect(block.source!.ref).toBe("figure:figures/plot.pdf");
    expect(block.source!.hash).toBe("0123456789ab");
    expect(slice(html, block.source!.range)).toBe("figure:figures/plot.pdf");
    expect(slice(html, block.source!.hashRange)).toBe("0123456789ab");
  });

  it("1.2d reads an entity-decoded source without hash", () => {
    const html = talk(`<section data-slide><div data-block="eq" data-source="eq:a&amp;b" ${BOX}></div></section>`);
    const all = parseDeck(html).model!.slides[0]!.blocks;
    const block = all[0]!;
    expect(block.source!.ref).toBe("eq:a&b");
    expect(slice(html, block.source!.range)).toBe("eq:a&amp;b");
    expect(block.source!.hash).toBeUndefined();
    expect(block.source!.hashRange).toBeUndefined();
  });

  it("1.2d has no source on a block without data-source", () => {
    const all = parseDeck(SAMPLE).model!.slides[0]!.blocks;
    const title = all[0]!;
    expect(title.source).toBeUndefined();
  });

  it("1.2d leaves out slides that are not direct children of body", () => {
    const html = talk(
      '<section data-slide><div data-block="a"></div></section>' +
        '<div class="wrap"><section data-slide><div data-block="b"></div></section></div>' +
        '<section><div data-block="c"></div></section>',
    );
    const model = parseDeck(html).model!;
    expect(model.slides).toHaveLength(1);
    expect(model.slides[0]!.blocks.map((b) => b.id)).toEqual(["a"]);
  });

  it("1.2d leaves out blocks that are not direct children of a slide", () => {
    const html = talk(
      '<div data-block="loose"></div>' +
        '<section data-slide><div data-block="a"></div><div class="wrap"><div data-block="deep"></div></div></section>',
    );
    const model = parseDeck(html).model!;
    expect(model.slides).toHaveLength(1);
    expect(model.slides[0]!.blocks.map((b) => b.id)).toEqual(["a"]);
  });

  it("1.2d leaves out notes that are not direct children of a slide", () => {
    const html = talk(`<section data-slide><div data-block="a" ${BOX}><aside data-notes>inside</aside></div></section>`);
    expect(parseDeck(html).model!.slides[0]!.notes).toBeUndefined();
  });
});

describe("parseDeck problems", () => {
  const expectPosition = (html: string, problem: { offset: number; line: number; column: number }) => {
    expect({ line: problem.line, column: problem.column }).toEqual(lineColumn(html, problem.offset));
  };

  it("1.2e reports an element skipped by an end tag as not closed", () => {
    const html = [
      '<html data-deck="talk">',
      "<head></head>",
      "<body>",
      '<section data-slide><div data-block="a">',
      "<p>Hi</div>",
      "</section>",
      "</body>",
      "</html>",
    ].join("\n");
    const result = parseDeck(html);
    const problem = result.problems.find((p) => p.message.includes("<p> is not closed"));
    expect(problem).toBeDefined();
    expect(problem!.line).toBe(5);
    expectPosition(html, problem!);
    expect(result.model).toBeDefined();
    expect(result.model!.slides[0]!.blocks.map((b) => b.id)).toEqual(["a"]);
  });

  it("1.2e reports a stray end tag and ignores it", () => {
    const html = ["<html>", "<head></head>", "<body>", "<section data-slide>  </span>", "</section>", "</body>", "</html>"].join("\n");
    const result = parseDeck(html);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.line).toBe(4);
    expectPosition(html, result.problems[0]!);
    expect(result.model!.slides).toHaveLength(1);
  });

  it("1.2e reports elements still open at the end", () => {
    const html = "<html>\n<head></head>\n<body>\n<section data-slide>\n";
    const result = parseDeck(html);
    expect(result.problems.some((p) => p.message.includes("section"))).toBe(true);
    for (const problem of result.problems) expectPosition(html, problem);
  });

  it("1.2e implies no end tags", () => {
    const html = talk(`<section data-slide><div data-block="a" ${BOX}><p>one<p>two</div></section>`);
    const result = parseDeck(html);
    expect(result.problems.filter((p) => p.message.includes("<p> is not closed"))).toHaveLength(2);
  });

  it("1.2e accepts void and self-closed elements without end tags", () => {
    const html = talk(`<section data-slide><div data-block="a" ${BOX}><p>a<br>b</p><img src="assets/x.png"><span /></div></section>`);
    expect(parseDeck(html).problems).toEqual([]);
  });

  it("1.2e counts \\r\\n as one line break", () => {
    const html = ["<html>", "<head></head>", "<body>", "  </em>", "</body>", "</html>"].join("\r\n");
    const result = parseDeck(html);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.line).toBe(4);
    expect(result.problems[0]!.column).toBe(3);
    expect(result.problems[0]!.offset).toBe(html.indexOf("</em>"));
  });

  it("1.2e reports a duplicate attribute", () => {
    const html = talk('\n<section data-slide data-slide><div data-block="a"></div></section>');
    const result = parseDeck(html);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]!.line).toBe(5);
    expectPosition(html, result.problems[0]!);
  });

  it("1.2e reports an unterminated comment without throwing", () => {
    const html = "<html><head></head><body>\n<!-- never closed </body></html>";
    const result = parseDeck(html);
    expect(result.problems.length).toBeGreaterThan(0);
    for (const problem of result.problems) expectPosition(html, problem);
  });

  it("1.2e reports an unterminated quoted attribute value without throwing", () => {
    const html = '<html><head></head><body>\n<div class="x></div></body></html>';
    const result = parseDeck(html);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("1.2e has no model without an html element", () => {
    const result = parseDeck("<body><section data-slide><p></section></body>");
    expect(result.model).toBeUndefined();
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("1.2e has no model without a body element inside html", () => {
    const result = parseDeck('<html data-deck="talk"><head></head></html>');
    expect(result.model).toBeUndefined();
  });

  it("1.2e has no model for an empty document", () => {
    expect(parseDeck("").model).toBeUndefined();
  });
});
