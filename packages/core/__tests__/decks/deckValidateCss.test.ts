// Tests validateDeck asset references (DECK015, DECK016) and listDeckRules (spec 1.3).
// Written as if the file sat at packages/core/__tests__/decks/deckValidateCss.test.ts; relative imports are resolved from there.
import { listDeckRules, validateDeck } from "../../src/decks/deckValidate.js";
import { HEAD, SAMPLE_TALK, SEVERITY, TALK_FILES, TALK_OPTIONS, THEME, at, block, expectCode, talk, withCode } from "./deckSamples.js";

describe("validateDeck: asset references (DECK015, DECK016)", () => {
  it("1.3b DECK015 a remote img src", () => {
    expectCode(validateDeck(talk(block("a", '<img src="https://example.org/x.png" alt="x">'))), "DECK015");
  });

  it("1.3b DECK016 a reference missing from files", () => {
    const found = expectCode(validateDeck(talk(block("a", '<img src="assets/missing.png" alt="x">')), TALK_OPTIONS), "DECK016");
    expect(found).toHaveLength(1);
  });
});

describe("validateDeck: asset references", () => {
  it("1.3e an <a href> to https is allowed", () => {
    expect(validateDeck(talk(block("a", '<p><a href="https://example.org/paper">paper</a></p>')), TALK_OPTIONS)).toEqual([]);
  });

  it.each([
    ["an absolute src", '<img src="/assets/plot.png" alt="x">', "/assets/plot.png"],
    ["an https src", '<img src="https://example.org/plot.png" alt="x">', "https://example.org/plot.png"],
    ["an http src", '<img src="http://example.org/plot.png" alt="x">', "http://example.org/plot.png"],
    ["a protocol-relative src", '<img src="//cdn.example.org/plot.png" alt="x">', "//cdn.example.org/plot.png"],
    ["a file: src", '<img src="file:///tmp/plot.png" alt="x">', "file:///tmp/plot.png"],
    ["a blob: src", '<img src="blob:abc-123" alt="x">', "blob:abc-123"],
    ["a src escaping the folder", '<img src="../plot.png" alt="x">', "../plot.png"],
    ["a src escaping after normalising", '<img src="assets/../../plot.png" alt="x">', "assets/../../plot.png"],
    ["a remote srcset candidate", '<img src="assets/plot.png" srcset="assets/plot.png 1x, https://example.org/big.png 2x" alt="x">', "https://example.org/big.png"],
    ["a remote video poster", '<video poster="https://example.org/still.png"></video>', "https://example.org/still.png"],
    ["a remote SVG image href", '<svg><image href="https://example.org/a.png"/></svg>', "https://example.org/a.png"],
    ["an absolute SVG use xlink:href", '<svg><use xlink:href="/sprite.svg#icon"/></svg>', "/sprite.svg#icon"],
    ["a remote url() in a style attribute", '<p style="background: url(https://example.org/bg.png);">x</p>', "https://example.org/bg.png"],
  ])("1.3e %s is one DECK015 error naming the URL", (_what, element, url) => {
    const found = expectCode(validateDeck(talk(block("a", element)), TALK_OPTIONS), "DECK015");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain(url);
  });

  it("1.3e a remote link href in the head is an error", () => {
    const html = talk(block("a"), HEAD.replace("</head>", '<link rel="icon" href="https://example.org/favicon.ico">\n</head>'));
    expect(withCode(validateDeck(html), "DECK015")).toEqual([expect.objectContaining({ severity: "error" })]);
  });

  it("1.3e a url() escaping the folder in a style element is an error located at url(", () => {
    const html = talk(block("a"), HEAD.replace("</head>", '<style>body { background: url("../bg.png"); }</style>\n</head>'));
    const found = expectCode(validateDeck(html), "DECK015");
    expect(found).toHaveLength(1);
    expect({ line: found[0].line, column: found[0].column }).toEqual(at(html, "url("));
  });

  it("1.3e an absolute url() in the theme is an error with file theme.css", () => {
    const theme = `${THEME}body { background: url(/bg.png); }\n`;
    const found = withCode(validateDeck(SAMPLE_TALK, { theme, files: TALK_FILES }), "DECK015");
    expect(found).toEqual([expect.objectContaining({ severity: "error", file: "theme.css", ...at(theme, "url(") })]);
  });

  it("1.3e a data: URL and a url(#fragment) are allowed", () => {
    const element = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x"><p style="fill: url(#grad);">x</p>';
    expect(validateDeck(talk(block("a", element)), TALK_OPTIONS)).toEqual([]);
  });

  it("1.3e a reference missing from files is a DECK016 warning", () => {
    const diagnostics = validateDeck(talk(block("a", '<img src="assets/missing.png" alt="x">')), TALK_OPTIONS);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "DECK016", severity: "warning" })]);
  });

  it("1.3e references are normalised before the files check", () => {
    const element = '<img src="./assets/plot.png?v=2#top" alt="x"><img src="assets/my%20plot.png" alt="y">';
    const files = new Set(["theme.css", "assets/plot.png", "assets/my plot.png"]);
    expect(validateDeck(talk(block("a", element)), { theme: THEME, files })).toEqual([]);
  });

  it("1.3e missing files are not reported without the files option", () => {
    expect(validateDeck(talk(block("a", '<img src="assets/missing.png" alt="x">')))).toEqual([]);
  });

  it("1.3e theme.css missing from files is a DECK016 warning", () => {
    const diagnostics = validateDeck(SAMPLE_TALK, { theme: THEME, files: new Set(["assets/plot.png"]) });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "DECK016", severity: "warning" })]);
  });

  it("1.3e a theme url() missing from files is a DECK016 warning in theme.css", () => {
    const theme = `${THEME}body { background: url(assets/bg.png); }\n`;
    const diagnostics = validateDeck(SAMPLE_TALK, { theme, files: TALK_FILES });
    expect(diagnostics).toEqual([expect.objectContaining({ code: "DECK016", severity: "warning", file: "theme.css" })]);
  });

  it("1.3e an unsafe reference is not also reported as missing", () => {
    const diagnostics = validateDeck(talk(block("a", '<img src="../plot.png" alt="x">')), TALK_OPTIONS);
    expect(withCode(diagnostics, "DECK016")).toEqual([]);
  });
});

describe("listDeckRules", () => {
  it("1.3f lists the 25 rules DECK001 to DECK025 in code order", () => {
    const codes = Array.from({ length: 25 }, (_, i) => `DECK${String(i + 1).padStart(3, "0")}`);
    expect(listDeckRules().map((r) => r.code)).toEqual(codes);
  });

  it("1.3f each rule has the severity of its diagnostics", () => {
    for (const rule of listDeckRules()) expect(rule.severity).toBe(SEVERITY[rule.code]);
  });

  it("1.3f each rule has a non-empty summary and hint", () => {
    for (const rule of listDeckRules()) {
      expect(rule.summary.trim().length).toBeGreaterThan(0);
      expect(rule.hint.trim().length).toBeGreaterThan(0);
      expect(rule.hint).not.toContain("\n");
    }
  });

  it("1.3f the DECK011 hint is the stated fix", () => {
    expect(listDeckRules().find((r) => r.code === "DECK011")?.hint).toBe("Give the block an inline style with left, top, width and height in px.");
  });

  it("1.3f returns a fresh array each call", () => {
    const first = listDeckRules();
    first.pop();
    expect(listDeckRules()).toHaveLength(25);
    expect(listDeckRules()).not.toBe(listDeckRules());
  });
});
