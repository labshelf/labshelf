// Tests validateDeck and listDeckRules (spec 1.3): error-free samples pass, every DECK001..DECK024 rule has a failing sample with its severity,
// diagnostics carry location, slide, block, message and hint, and output is sorted and deterministic. Asset references are in deckValidateCss.test.ts.
// Written as if the file sat at packages/core/__tests__/decks/deckValidate.test.ts; relative imports are resolved from there.
import { listDeckRules, validateDeck, type DeckValidateOptions } from "../../src/decks/deckValidate.js";
import {
  HEAD, POSTER_ROOT, SAMPLE_POSTER, SAMPLE_TALK, STYLE, TALK_OPTIONS, TALK_ROOT, THEME,
  at, block, compareDiagnostics, doc, expectCode, poster, slide, talk, withCode,
} from "./deckSamples.js";

describe("validateDeck: error-free samples", () => {
  it("1.3a the sample talk with theme and files gives no diagnostics", () => {
    expect(validateDeck(SAMPLE_TALK, TALK_OPTIONS)).toEqual([]);
  });

  it("1.3a the sample poster with theme and files gives no diagnostics", () => {
    expect(validateDeck(SAMPLE_POSTER, { theme: THEME, files: new Set(["theme.css"]) })).toEqual([]);
  });

  it("1.3a the sample talk without options gives no diagnostics", () => {
    expect(validateDeck(SAMPLE_TALK)).toEqual([]);
  });
});

describe("validateDeck: root, size and slides (DECK001-DECK008)", () => {
  it("1.3b DECK001 a document without an html element", () => {
    const diagnostics = validateDeck("<p>Hello</p>\n");
    expect(diagnostics).toEqual([expect.objectContaining({ code: "DECK001", severity: "error", line: 1, column: 1 })]);
  });

  it("1.3b DECK001 an html element without a body", () => {
    expectCode(validateDeck(`<!doctype html>\n<html lang="en" ${TALK_ROOT}>\n${HEAD}\n</html>\n`), "DECK001");
  });

  it("1.3b DECK001 data-deck that is not talk or poster", () => {
    expectCode(validateDeck(SAMPLE_TALK.replace('data-deck="talk"', 'data-deck="slides"')), "DECK001");
  });

  it("1.3b DECK001 data-deck missing", () => {
    expectCode(validateDeck(SAMPLE_TALK.replace('data-deck="talk" ', "")), "DECK001");
  });

  it("1.3b DECK002 data-deck-version not 1", () => {
    expectCode(validateDeck(SAMPLE_TALK.replace('data-deck-version="1"', 'data-deck-version="2"')), "DECK002");
  });

  it("1.3b DECK002 data-deck-version missing", () => {
    expectCode(validateDeck(SAMPLE_TALK.replace('data-deck-version="1" ', "")), "DECK002");
  });

  it("1.3b DECK003 a malformed size, located at the data-deck-size value", () => {
    const html = SAMPLE_TALK.replace('data-deck-size="1920x1080px"', 'data-deck-size="1920x1080"');
    const [d] = expectCode(validateDeck(html), "DECK003");
    expect({ line: d.line, column: d.column }).toEqual(at(html, "1920x1080\""));
  });

  it("1.3b DECK003 a talk size outside 320..7680 px", () => {
    expectCode(validateDeck(SAMPLE_TALK.replace('data-deck-size="1920x1080px"', 'data-deck-size="100x100px"')), "DECK003");
  });

  it("1.3b DECK003 a poster size outside 100..2438.4 mm", () => {
    expectCode(validateDeck(SAMPLE_POSTER.replace('data-deck-size="841x1189mm"', 'data-deck-size="50x80mm"')), "DECK003");
  });

  it("1.3b DECK003 data-deck-size missing", () => {
    expectCode(validateDeck(SAMPLE_TALK.replace(' data-deck-size="1920x1080px"', "")), "DECK003");
  });

  it("1.3b DECK004 a talk with a mm size, instead of DECK003", () => {
    const html = SAMPLE_TALK.replace('data-deck-size="1920x1080px"', 'data-deck-size="841x1189mm"');
    const diagnostics = validateDeck(html);
    const [d] = expectCode(diagnostics, "DECK004");
    expect(withCode(diagnostics, "DECK003")).toEqual([]);
    expect({ line: d.line, column: d.column }).toEqual(at(html, "841x1189mm"));
  });

  it("1.3b DECK004 a poster with a px size, instead of DECK003", () => {
    const diagnostics = validateDeck(SAMPLE_POSTER.replace('data-deck-size="841x1189mm"', 'data-deck-size="1920x1080px"'));
    expectCode(diagnostics, "DECK004");
    expect(withCode(diagnostics, "DECK003")).toEqual([]);
  });

  it("1.3b DECK005 a body without a slide, located at the body tag", () => {
    const html = doc(TALK_ROOT, "<div>No slides here.</div>");
    const [d] = expectCode(validateDeck(html), "DECK005");
    expect({ line: d.line, column: d.column }).toEqual(at(html, "<body"));
  });

  it("1.3b DECK006 a poster with two slides, on the second", () => {
    const html = doc(POSTER_ROOT, `${slide(block("a"))}\n${slide(block("b"))}`);
    const found = expectCode(validateDeck(html), "DECK006");
    expect(found).toHaveLength(1);
    expect({ line: found[0].line, column: found[0].column }).toEqual(at(html, "<section data-slide>", 1));
  });

  it("1.3b DECK006 a poster with three slides, on each slide after the first", () => {
    const html = doc(POSTER_ROOT, `${slide(block("a"))}\n${slide(block("b"))}\n${slide(block("c"))}`);
    expect(expectCode(validateDeck(html), "DECK006")).toHaveLength(2);
  });

  it("1.3b DECK007 a data-slide element that is not a section", () => {
    const html = doc(TALK_ROOT, `${slide(block("a"))}\n<div data-slide></div>`);
    const [d] = expectCode(validateDeck(html), "DECK007");
    expect({ line: d.line, column: d.column }).toEqual(at(html, "<div data-slide>"));
  });

  it("1.3b DECK008 the theme link missing", () => {
    const head = HEAD.replace('<link rel="stylesheet" href="theme.css" data-deck-theme>\n', "");
    expectCode(validateDeck(talk(block("a"), head)), "DECK008");
  });

  it("1.3b DECK008 a second theme link, on the extra one", () => {
    const link = '<link rel="stylesheet" href="theme.css" data-deck-theme>';
    const html = talk(block("a"), HEAD.replace(link, `${link}\n${link}`));
    const found = expectCode(validateDeck(html), "DECK008");
    expect(found).toHaveLength(1);
    expect({ line: found[0].line, column: found[0].column }).toEqual(at(html, link, 1));
  });

  it("1.3b DECK008 the theme link in the body instead of the head", () => {
    const link = '<link rel="stylesheet" href="theme.css" data-deck-theme>';
    const html = doc(TALK_ROOT, `${link}\n${slide(block("a"))}`, HEAD.replace(`${link}\n`, ""));
    expectCode(validateDeck(html), "DECK008");
  });

  it("1.3b DECK008 a theme link whose href is not theme.css", () => {
    expectCode(validateDeck(talk(block("a"), HEAD.replace('href="theme.css"', 'href="style.css"'))), "DECK008");
  });

  it("1.3b DECK008 a theme link without rel stylesheet", () => {
    expectCode(validateDeck(talk(block("a"), HEAD.replace('rel="stylesheet"', 'rel="preload"'))), "DECK008");
  });
});

describe("validateDeck: blocks (DECK009-DECK012)", () => {
  it("1.3b DECK009 a block inside another block", () => {
    expectCode(validateDeck(talk(block("outer", `<div><div data-block="inner" style="${STYLE}"><p>x</p></div></div>`))), "DECK009");
  });

  it("1.3b DECK009 a data-block element directly in body", () => {
    expectCode(validateDeck(doc(TALK_ROOT, `${slide(block("a"))}\n${block("loose")}`)), "DECK009");
  });

  it("1.3b DECK010 a block id that does not match the pattern, named in the message", () => {
    const [d] = expectCode(validateDeck(talk(block("Title"))), "DECK010");
    expect(d.message).toContain("Title");
  });

  it("1.3b DECK010 a block id longer than 40 characters", () => {
    expectCode(validateDeck(talk(block(`a${"b".repeat(40)}`))), "DECK010");
  });

  it("1.3b DECK010 a repeated block id, on the repeat", () => {
    const html = doc(TALK_ROOT, `${slide(block("dup"))}\n${slide(block("dup"))}`);
    const found = expectCode(validateDeck(html), "DECK010");
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(1);
  });

  it("1.3b DECK011 a block style without height", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", "left: 120px; top: 80px; width: 400px;"))), "DECK011");
  });

  it("1.3b DECK011 a block without a style attribute", () => {
    expectCode(validateDeck(talk('<div data-block="a"><p>x</p></div>')), "DECK011");
  });

  it("1.3b DECK011 a value with more than 2 decimals", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", "left: 1.234px; top: 80px; width: 400px; height: 200px;"))), "DECK011");
  });

  it("1.3b DECK011 a value not in px", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", "left: 10em; top: 80px; width: 400px; height: 200px;"))), "DECK011");
  });

  it("1.3b DECK011 a negative width", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", "left: 10px; top: 80px; width: -400px; height: 200px;"))), "DECK011");
  });

  it("1.3b DECK012 a block past the right edge of the canvas", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", "left: 1800px; top: 80px; width: 400px; height: 200px;"))), "DECK012");
  });

  it("1.3b DECK012 a block with a negative top", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", "left: 10px; top: -5px; width: 400px; height: 200px;"))), "DECK012");
  });

  it("1.3b DECK012 a block ending exactly at the canvas edge is not reported", () => {
    const html = talk(block("a", "<p>x</p>", "left: 1520px; top: 880px; width: 400px; height: 200px;"));
    expect(withCode(validateDeck(html), "DECK012")).toEqual([]);
  });

  it("1.3b DECK012 a poster block past the bottom of the A0 canvas", () => {
    expectCode(validateDeck(poster(block("a", "<p>x</p>", "left: 100px; top: 4400px; width: 400px; height: 200px;"))), "DECK012");
  });
});

describe("validateDeck: unsafe content (DECK013, DECK014)", () => {
  it("1.3b DECK013 a script element", () => {
    const head = HEAD.replace("</head>", "<script>alert(1)</script>\n</head>");
    expectCode(validateDeck(talk(block("a"), head)), "DECK013");
  });

  it("1.3b DECK013 an on* attribute, located at the attribute name", () => {
    const html = talk(block("a", '<p onclick="go()">x</p>'));
    const [d] = expectCode(validateDeck(html), "DECK013");
    expect({ line: d.line, column: d.column }).toEqual(at(html, "onclick"));
  });

  it("1.3b DECK013 a javascript: URL with mixed case, whitespace and control characters", () => {
    expectCode(validateDeck(talk(block("a", '<p><a href=" Java\tScr\u0001ipt:alert(1)">x</a></p>'))), "DECK013");
  });

  it.each([
    ["iframe", "<iframe></iframe>"],
    ["object", "<object></object>"],
    ["embed", "<embed>"],
    ["frame", "<frame></frame>"],
    ["frameset", "<frameset></frameset>"],
    ["form", "<form></form>"],
  ])("1.3b DECK014 a %s element", (_name, element) => {
    const html = talk(block("a", element));
    const [d] = expectCode(validateDeck(html), "DECK014");
    expect({ line: d.line, column: d.column }).toEqual(at(html, element.slice(0, element.indexOf(">"))));
  });

  it("1.3b DECK014 a base element", () => {
    expectCode(validateDeck(talk(block("a"), HEAD.replace("</head>", '<base target="_blank">\n</head>'))), "DECK014");
  });

  it("1.3b DECK014 a meta http-equiv refresh, case-insensitive", () => {
    expectCode(validateDeck(talk(block("a"), HEAD.replace("</head>", '<meta http-equiv="Refresh" content="0">\n</head>'))), "DECK014");
  });
});

describe("validateDeck: notes, math, sources, CSS, markup, theme (DECK017-DECK024)", () => {
  it("1.3b DECK017 a second notes element in a slide, on the extra one", () => {
    const html = talk(`${block("a")}\n<aside data-notes>One.</aside>\n<aside data-notes>Two.</aside>`);
    const found = expectCode(validateDeck(html), "DECK017");
    expect(found).toHaveLength(1);
    expect({ line: found[0].line, column: found[0].column }).toEqual(at(html, "<aside data-notes>", 1));
  });

  it("1.3b DECK017 a notes element inside a block", () => {
    expectCode(validateDeck(talk(block("a", "<aside data-notes>Hidden.</aside>"))), "DECK017");
  });

  it("1.3b DECK018 a notes element in a poster", () => {
    expectCode(validateDeck(poster(`${block("a")}\n<aside data-notes>Notes.</aside>`)), "DECK018");
  });

  it("1.3b DECK019 math with an unclosed brace", () => {
    expectCode(validateDeck(talk(block("a", "<p><span data-math>\\frac{a}{b</span></p>"))), "DECK019");
  });

  it("1.3b DECK019 math with a closing brace before its opening one", () => {
    expectCode(validateDeck(talk(block("a", '<div data-math="display">a}{b</div>'))), "DECK019");
  });

  it("1.3b DECK019 escaped braces do not count", () => {
    expect(withCode(validateDeck(talk(block("a", "<p><span data-math>\\{x</span></p>"))), "DECK019")).toEqual([]);
  });

  it("1.3b DECK020 data-source on an element that is not a block", () => {
    expectCode(validateDeck(talk(block("a", '<p data-source="eq:energy">x</p>'))), "DECK020");
  });

  it.each([
    ["an unknown kind", "chart:plot"],
    ["an empty rest", "eq:"],
    ["whitespace in the rest", "cite:smith 2020"],
    ["an absolute figure path", "figure:/figures/plot.pdf"],
    ["a figure path leaving the project", "figure:figures/../../plot.pdf"],
  ])("1.3b DECK020 a data-source value with %s", (_what, value) => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", STYLE, ` data-source="${value}" data-source-hash="3f2a9c1b7e04"`))), "DECK020");
  });

  it.each([
    ["uppercase hex", "3F2A9C1B7E04"],
    ["too short", "3f2a9c"],
    ["non-hex characters", "3f2a9c1b7e0z"],
  ])("1.3b DECK020 a data-source-hash with %s", (_what, hash) => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", STYLE, ` data-source="eq:energy" data-source-hash="${hash}"`))), "DECK020");
  });

  it("1.3b DECK021 a block with data-source and no data-source-hash", () => {
    const diagnostics = validateDeck(talk(block("a", "<p>x</p>", STYLE, ' data-source="cite:smith2020"')));
    expectCode(diagnostics, "DECK021");
    expect(withCode(diagnostics, "DECK020")).toEqual([]);
  });

  it("1.3b DECK022 backdrop-filter in a style attribute", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p>", `${STYLE} backdrop-filter: blur(4px);`))), "DECK022");
  });

  it("1.3b DECK022 a filter inside @keyframes in a style element", () => {
    const head = HEAD.replace("</head>", "<style>@keyframes fade { from { filter: blur(0); } to { filter: blur(4px); } }</style>\n</head>");
    expectCode(validateDeck(talk(block("a"), head)), "DECK022");
  });

  it("1.3b DECK022 a transition naming filter", () => {
    expectCode(validateDeck(talk(block("a", '<p style="transition: filter 0.3s;">x</p>'))), "DECK022");
  });

  it("1.3b DECK022 a transition-property naming filter", () => {
    expectCode(validateDeck(talk(block("a", '<p style="transition-property: opacity, filter;">x</p>'))), "DECK022");
  });

  it("1.3b DECK022 a static filter and a transition without filter are not reported", () => {
    const html = talk(block("a", '<p style="filter: blur(2px); transition: opacity 0.3s;">x</p>'));
    expect(withCode(validateDeck(html), "DECK022")).toEqual([]);
  });

  it("1.3b DECK022 backdrop-filter in the theme, with file theme.css", () => {
    const theme = `${THEME}.card { backdrop-filter: blur(4px); }\n`;
    const [d] = expectCode(validateDeck(SAMPLE_TALK, { theme }), "DECK022");
    expect(d.file).toBe("theme.css");
    expect({ line: d.line, column: d.column }).toEqual(at(theme, "backdrop-filter"));
  });

  it("1.3b DECK023 an unclosed element", () => {
    expectCode(validateDeck(talk('<div data-block="a" style="left: 1px; top: 1px; width: 10px; height: 10px;"><p>Text</div>')), "DECK023");
  });

  it("1.3b DECK023 a stray end tag", () => {
    expectCode(validateDeck(talk(block("a", "<p>x</p></span>"))), "DECK023");
  });

  it("1.3b DECK023 a duplicate attribute", () => {
    expectCode(validateDeck(talk(block("a", '<img src="assets/plot.png" src="assets/plot.png" alt="x">'))), "DECK023");
  });

  it("1.3b DECK023 an unterminated comment", () => {
    expectCode(validateDeck(`${SAMPLE_TALK}<!-- never closed`), "DECK023");
  });

  it("1.3b DECK024 a theme without a :root rule, at 1:1 of theme.css", () => {
    const diagnostics = validateDeck(SAMPLE_TALK, { theme: "body { color: red; }\n" });
    const [d] = expectCode(diagnostics, "DECK024");
    expect(d).toEqual(expect.objectContaining({ file: "theme.css", line: 1, column: 1 }));
  });

  it("1.3b DECK024 a :root rule without custom properties", () => {
    expectCode(validateDeck(SAMPLE_TALK, { theme: ":root { color: red; }\n" }), "DECK024");
  });

  it("1.3b DECK024 is not reported without a theme option", () => {
    expect(withCode(validateDeck(SAMPLE_TALK), "DECK024")).toEqual([]);
  });

  it("1.3b token rules still run when there is no model", () => {
    const diagnostics = validateDeck("<div><script>alert(1)</script></div>\n");
    expectCode(diagnostics, "DECK001");
    expectCode(diagnostics, "DECK013");
  });
});

describe("validateDeck: diagnostic fields", () => {
  it("1.3c an on* attribute in a block on the second slide carries slide, block, location, message and hint", () => {
    const html = doc(TALK_ROOT, `${slide(block("intro"))}\n${slide(block("detail", '<p onclick="go()">x</p>'))}`);
    const rule = listDeckRules().find((r) => r.code === "DECK013");
    expect(validateDeck(html)).toEqual([
      { code: "DECK013", severity: "error", slide: 1, block: "detail", ...at(html, "onclick"), message: expect.any(String), hint: rule?.hint },
    ]);
  });

  it("1.3c an iframe in the first slide's block is located at its start tag", () => {
    const html = doc(TALK_ROOT, `${slide(block("intro", "<iframe></iframe>"))}\n${slide(block("detail"))}`);
    const [d] = expectCode(validateDeck(html), "DECK014");
    expect(d).toEqual(expect.objectContaining({ slide: 0, block: "intro", ...at(html, "<iframe") }));
  });

  it("1.3c a slide-level diagnostic carries the slide and no block", () => {
    const html = doc(POSTER_ROOT, `${slide(block("a"))}\n${slide(block("b"))}`);
    const [d] = expectCode(validateDeck(html), "DECK006");
    expect(d.slide).toBe(1);
    expect(d.block).toBeUndefined();
  });

  it("1.3c a diagnostic in the head carries neither slide nor block", () => {
    const html = talk(block("a"), HEAD.replace("</head>", "<script>alert(1)</script>\n</head>"));
    const [d] = expectCode(validateDeck(html), "DECK013");
    expect(d).toEqual(expect.objectContaining({ ...at(html, "<script") }));
    expect(d.slide).toBeUndefined();
    expect(d.block).toBeUndefined();
  });

  it("1.3c lines and columns are 1-based and count after line breaks", () => {
    const html = talk(block("a", '<p>x</p>\n  <img src="/abs.png" alt="x">'));
    const [d] = expectCode(validateDeck(html), "DECK015");
    expect({ line: d.line, column: d.column }).toEqual(at(html, "src=\"/abs.png\""));
  });

  it("1.3c the hint of every diagnostic equals its rule's hint", () => {
    const html = doc(TALK_ROOT, `${slide(block("Bad", '<p onclick="x()">x</p><iframe></iframe>'))}\n<div data-slide></div>`);
    const hints = new Map(listDeckRules().map((r) => [r.code, r.hint]));
    const diagnostics = validateDeck(html, { theme: "body {}\n" });
    expect(diagnostics.length).toBeGreaterThanOrEqual(4);
    for (const d of diagnostics) expect(d.hint).toBe(hints.get(d.code));
  });
});

const MESSY = doc(
  TALK_ROOT,
  [
    slide(block("Bad", '<p onclick="x()">x</p><iframe onload="y()"></iframe>', `${STYLE} backdrop-filter: blur(2px); background: url(https://example.org/bg.png);`)),
    slide(block("ok", '<img src="assets/missing.png" alt="x"><span data-math>{</span>')),
    '<div data-slide data-block="both"></div>',
  ].join("\n"),
  HEAD.replace("</head>", "<script>alert(1)</script>\n</head>"),
);
const MESSY_THEME = `${THEME}body { background: url(/bg.png); }\n.a { backdrop-filter: blur(1px); }\n`;
const MESSY_OPTIONS: DeckValidateOptions = { theme: MESSY_THEME, files: new Set(["theme.css"]) };

describe("validateDeck: order and determinism", () => {
  it("1.3d diagnostics are sorted by line, column and code", () => {
    const diagnostics = validateDeck(MESSY, MESSY_OPTIONS);
    expect(diagnostics.length).toBeGreaterThanOrEqual(8);
    expect(diagnostics).toEqual([...diagnostics].sort(compareDiagnostics));
  });

  it("1.3d theme diagnostics come after deck ones and carry file theme.css", () => {
    const diagnostics = validateDeck(MESSY, MESSY_OPTIONS);
    const firstTheme = diagnostics.findIndex((d) => d.file === "theme.css");
    expect(firstTheme).toBeGreaterThan(0);
    expect(diagnostics.slice(firstTheme).every((d) => d.file === "theme.css")).toBe(true);
    expect(diagnostics.slice(0, firstTheme).every((d) => d.file === undefined)).toBe(true);
    expect(diagnostics.slice(firstTheme).map((d) => d.code)).toEqual(["DECK015", "DECK022"]);
  });

  it("1.3d two codes at one start tag are ordered by code", () => {
    const html = doc(TALK_ROOT, `${slide(block("a"))}\n<div data-slide data-block="both"></div>`);
    const diagnostics = validateDeck(html).filter((d) => d.line === at(html, "<div data-slide").line);
    expect(diagnostics.map((d) => d.code)).toEqual(["DECK007", "DECK009"]);
  });

  it("1.3d two runs on the same input give deep-equal results", () => {
    expect(validateDeck(MESSY, MESSY_OPTIONS)).toEqual(validateDeck(MESSY, MESSY_OPTIONS));
  });
});

describe("validateDeck: A1", () => {
  it("A1 the same input gives deep-equal diagnostics with code, severity, location and hint", () => {
    const first = validateDeck(MESSY, MESSY_OPTIONS);
    const second = validateDeck(MESSY, MESSY_OPTIONS);
    expect(second).toEqual(first);
    for (const d of first) {
      expect(d).toEqual(expect.objectContaining({ code: expect.any(String), severity: expect.any(String), line: expect.any(Number), column: expect.any(Number), hint: expect.any(String) }));
    }
  });

  it("A1 the error-free talk and poster pass", () => {
    expect(validateDeck(SAMPLE_TALK, TALK_OPTIONS)).toEqual([]);
    expect(validateDeck(SAMPLE_POSTER, { theme: THEME, files: new Set(["theme.css"]) })).toEqual([]);
  });

  it("A1 every rule code has a failing sample in this file", () => {
    const samples: Array<[string, string, DeckValidateOptions | undefined]> = [
      ["DECK001", "<p>x</p>", undefined],
      ["DECK005", doc(TALK_ROOT, "<div>x</div>"), undefined],
      ["DECK012", talk(block("a", "<p>x</p>", "left: 1800px; top: 80px; width: 400px; height: 200px;")), undefined],
      ["DECK016", talk(block("a", '<img src="assets/missing.png" alt="x">')), TALK_OPTIONS],
      ["DECK024", SAMPLE_TALK, { theme: "body {}\n" }],
    ];
    for (const [code, html, options] of samples) expect(validateDeck(html, options).map((d) => d.code)).toContain(code);
  });

  it.each(["", "<", "<<<>>>", "<html", '<html data-deck="talk"><body><section data-slide><div data-block=', "\u0000￿", "</body></html>"])(
    "A1 never throws on malformed input %j",
    (input) => {
      expect(Array.isArray(validateDeck(input, { theme: "{{{", files: new Set() }))).toBe(true);
    },
  );
});
