// Spec 9.1: sanitizeDeckInline keeps the inline allow-list and unwraps or drops the rest, safeDeckHref accepts only safe link targets, and applyDeckEdit setInline writes sanitised inline HTML into a leaf.
import { applyDeckEdit, type DeckEdit } from "../../src/decks/deckEdit";
import { sanitizeDeckInline, safeDeckHref } from "../../src/decks/deckInline";

// --- 9.1a: sanitizeDeckInline ----------------------------------------------------------------------------------------------------------

describe("sanitizeDeckInline text and line breaks", () => {
  it("9.1a leaves plain text unchanged", () => {
    expect(sanitizeDeckInline("Hello world")).toBe("Hello world");
  });

  it("9.1a re-escapes & as an entity", () => {
    expect(sanitizeDeckInline("A &amp; B")).toBe("A &amp; B");
  });

  it("9.1a keeps escaped angle brackets as entities, not as markup", () => {
    expect(sanitizeDeckInline("a &lt;b&gt; c")).toBe("a &lt;b&gt; c");
  });

  it("9.1a keeps <br> and writes a self-closed <br/> as <br>", () => {
    expect(sanitizeDeckInline("a<br>b<br/>c")).toBe("a<br>b<br>c");
  });

  it("9.1a turns newlines in text into <br>", () => {
    expect(sanitizeDeckInline("a\nb")).toBe("a<br>b");
  });

  it("9.1a returns an empty string for empty input", () => {
    expect(sanitizeDeckInline("")).toBe("");
  });
});

describe("sanitizeDeckInline attribute-free elements", () => {
  const TAGS = ["b", "strong", "i", "em", "u", "s", "sub", "sup", "small", "mark", "code"];

  it.each(TAGS)("9.1a keeps <%s>", (tag) => {
    expect(sanitizeDeckInline(`x <${tag}>y</${tag}> z`)).toBe(`x <${tag}>y</${tag}> z`);
  });

  it.each(TAGS)("9.1a drops every attribute of <%s>", (tag) => {
    expect(sanitizeDeckInline(`<${tag} class="k" style="color: red" onclick="boom()">y</${tag}>`)).toBe(`<${tag}>y</${tag}>`);
  });

  it("9.1a keeps nested allowed elements", () => {
    expect(sanitizeDeckInline("<b>a <i>b</i> c</b>")).toBe("<b>a <i>b</i> c</b>");
  });

  it("9.1a drops an empty element", () => {
    expect(sanitizeDeckInline("a<b></b>c")).toBe("ac");
  });
});

describe("sanitizeDeckInline colour spans", () => {
  const COLORS = ["#abc", "#aabbcc", "#aabbccdd", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "hsl(120, 50%, 50%)", "hsla(120, 50%, 50%, .5)", "var(--accent)", "red", "rebeccapurple"];

  it.each(COLORS)("9.1a keeps a span with color: %s", (color) => {
    expect(sanitizeDeckInline(`<span style="color: ${color}">t</span>`)).toBe(`<span style="color: ${color}">t</span>`);
  });

  it("9.1a writes the style as color: C even when the input has no space", () => {
    expect(sanitizeDeckInline('<span style="color:#f00">t</span>')).toBe('<span style="color: #f00">t</span>');
  });

  it.each(["url(x)", "expression(alert(1))", "calc(1px)", "#12", "#ggg"])("9.1a unwraps a span whose color is %s", (color) => {
    expect(sanitizeDeckInline(`<span style="color: ${color}">t</span>`)).toBe("t");
  });

  it("9.1a drops every declaration but color", () => {
    expect(sanitizeDeckInline('<span style="color: #f00; background: url(x); font-size: 99px">t</span>')).toBe('<span style="color: #f00">t</span>');
  });

  it("9.1a unwraps a span left with no allowed style", () => {
    expect(sanitizeDeckInline('<span style="background: red">t</span>')).toBe("t");
  });

  it("9.1a unwraps a span without a style and drops its other attributes", () => {
    expect(sanitizeDeckInline('<span class="x" onclick="y()">t</span>')).toBe("t");
  });

  it("9.1a drops an empty colour span", () => {
    expect(sanitizeDeckInline('a<span style="color: #f00"></span>b')).toBe("ab");
  });

  it("9.1a drops attributes other than style on a colour span", () => {
    expect(sanitizeDeckInline('<span class="x" style="color: #f00" id="y">t</span>')).toBe('<span style="color: #f00">t</span>');
  });
});

describe("sanitizeDeckInline links", () => {
  it("9.1a keeps an https link with only its href", () => {
    expect(sanitizeDeckInline('<a href="https://example.com/a" target="_blank" onclick="x()" class="k">t</a>')).toBe('<a href="https://example.com/a">t</a>');
  });

  it.each(["http://example.com", "mailto:a@b.co", "#section", "docs/page.html"])("9.1a keeps a link to %s", (href) => {
    expect(sanitizeDeckInline(`<a href="${href}">t</a>`)).toBe(`<a href="${href}">t</a>`);
  });

  it.each(["javascript:alert(1)", "  JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "ftp://x.org"])("9.1a unwraps a link to %j", (href) => {
    expect(sanitizeDeckInline(`<a href="${href}">t</a>`)).toBe("t");
  });

  it("9.1a unwraps a link with no href", () => {
    expect(sanitizeDeckInline("<a>t</a>")).toBe("t");
  });

  it("9.1a escapes & in an href as &amp; and stays idempotent", () => {
    const out = sanitizeDeckInline('<a href="https://x.org/?a=1&amp;b=2">t</a>');
    expect(out).toBe('<a href="https://x.org/?a=1&amp;b=2">t</a>');
    expect(sanitizeDeckInline(out)).toBe(out);
  });

  it("9.1a keeps allowed inline markup inside a link", () => {
    expect(sanitizeDeckInline('<a href="https://x.org"><b>t</b></a>')).toBe('<a href="https://x.org"><b>t</b></a>');
  });
});

describe("sanitizeDeckInline unwrapping and dropping", () => {
  it.each(['<font color="red">t</font>', "<p>t</p>", "<div>t</div>", "<h2>t</h2>", "<strike>t</strike>"])("9.1a unwraps %s and keeps its text", (html) => {
    expect(sanitizeDeckInline(html)).toBe("t");
  });

  it("9.1a unwraps a disallowed element around an allowed one", () => {
    expect(sanitizeDeckInline("<div><b>x</b></div>")).toBe("<b>x</b>");
  });

  it("9.1a drops an element with no text, such as <img>", () => {
    expect(sanitizeDeckInline('a<img src="x.png" onerror="boom()">b')).toBe("ab");
  });

  it("9.1a drops <script> together with its content", () => {
    expect(sanitizeDeckInline("a<script>alert(1)</script>b")).toBe("ab");
  });

  it("9.1a drops <style> together with its content", () => {
    expect(sanitizeDeckInline("a<style>p { color: red }</style>b")).toBe("ab");
  });

  it("9.1a drops comments", () => {
    expect(sanitizeDeckInline("a<!-- hidden -->b")).toBe("ab");
  });

  it("9.1a turns the boundary between two block elements into <br>", () => {
    expect(sanitizeDeckInline("<div>a</div><div>b</div>")).toBe("a<br>b");
    expect(sanitizeDeckInline("<p>a</p><p>b</p>")).toBe("a<br>b");
  });

  it("9.1a adds no <br> at the outer edges of a single block element", () => {
    expect(sanitizeDeckInline("<p>a</p>")).toBe("a");
  });
});

describe("sanitizeDeckInline idempotence", () => {
  const INPUTS = [
    "plain",
    "A & B < C > D",
    "a\nb\nc",
    '<b class="x">bold</b> and <i>it</i>',
    '<span style="color: #f00; background: red">r</span><span style="color:rgb(1,2,3)">g</span>',
    '<a href="https://x.org/?a=1&amp;b=2" target="_blank">l</a><a href="javascript:x">j</a>',
    "<div>a</div><div>b<p>c</p></div>",
    "<script>x</script><style>y</style><!-- z --><font color=red>f</font>",
    '<b><i><u><s>deep</s></u></i></b><b></b><span style=""></span>',
    '<a href="  https://x.org  ">t</a>',
  ];

  it.each(INPUTS)("9.1a sanitize(sanitize(x)) equals sanitize(x) for %j", (input) => {
    const once = sanitizeDeckInline(input);
    expect(sanitizeDeckInline(once)).toBe(once);
  });
});

// --- 9.1a: safeDeckHref -----------------------------------------------------------------------------------------------------------------

describe("safeDeckHref", () => {
  it.each([
    "https://example.com/a?b=1#c",
    "http://example.org",
    "mailto:a@b.co",
    "MAILTO:a@b.co",
    "HTTPS://EXAMPLE.COM",
    "#section",
    "docs/page.html",
    "/abs/path",
    "../up.html",
    "./a:b",
    "a/b:c",
    "page.html?x=1:2",
    "?q=a:b",
    "page.html#x:y",
  ])("9.1a accepts %j and returns it", (href) => {
    expect(safeDeckHref(href)).toBe(href);
  });

  it("9.1a trims surrounding whitespace from an accepted href", () => {
    expect(safeDeckHref("  https://example.com  ")).toBe("https://example.com");
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java script:alert(1)",
    "jav\u0000ascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<b>x</b>",
    "ftp://example.org",
    "file:///etc/passwd",
    "tel:+123",
    "x:y",
  ])("9.1a refuses %j", (href) => {
    expect(safeDeckHref(href)).toBeNull();
  });

  it.each(["", "   ", "\t\n"])("9.1a refuses the empty href %j", (href) => {
    expect(safeDeckHref(href)).toBeNull();
  });
});

// --- 9.1b: applyDeckEdit setInline ------------------------------------------------------------------------------------------------------

const THEME_LINK = '<link rel="stylesheet" href="theme.css" data-deck-theme>';
function deckHtml(slides: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Sample deck</title>",
    `  ${THEME_LINK}`,
    "</head>",
    "<body>",
    ...slides.map((s) => `  ${s}`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
const TITLE_BLOCK = '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>';
const BODY_BLOCK =
  '<div data-block="body" style="left: 120px; top: 320px; width: 800px; height: 400px;"><p class="lead">First <i>one</i></p><div data-math="display">\\frac{a}{b}</div><p>Second</p></div>';
const TALK = deckHtml([`<section data-slide>\n    ${TITLE_BLOCK}\n  </section>`, `<section data-slide>\n    ${BODY_BLOCK}\n  </section>`]);

function swap(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`expected exactly one occurrence of ${JSON.stringify(from)}, found ${parts.length - 1}`);
  return `${parts[0]}${to}${parts[1]}`;
}

function expectRefused(html: string, edit: DeckEdit): void {
  const result = applyDeckEdit(html, edit);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.error).toBe("string");
  expect(result.error.trim().length).toBeGreaterThan(0);
  expect(result.error).not.toContain("\n");
}

describe("applyDeckEdit setInline", () => {
  it("9.1b writes allowed inline markup into the leaf and keeps every other byte", () => {
    const expected = swap(TALK, "<h1>Title</h1>", '<h1>Big <b>bold</b> and <span style="color: #f00">red</span></h1>');
    expect(applyDeckEdit(TALK, { kind: "setInline", block: "title", leaf: 0, html: 'Big <b>bold</b> and <span style="color: #f00">red</span>' })).toEqual({ ok: true, html: expected });
  });

  it("9.1b sanitises the html before writing it", () => {
    const expected = swap(TALK, "<h1>Title</h1>", "<h1>Hi <b>there</b></h1>");
    const result = applyDeckEdit(TALK, { kind: "setInline", block: "title", leaf: 0, html: 'Hi <b onclick="boom()">there</b><script>alert(1)</script>' });
    expect(result).toEqual({ ok: true, html: expected });
  });

  it("9.1b writes only a safe link", () => {
    const safe = applyDeckEdit(TALK, { kind: "setInline", block: "title", leaf: 0, html: '<a href="https://example.com">x</a>' });
    expect(safe).toEqual({ ok: true, html: swap(TALK, "<h1>Title</h1>", '<h1><a href="https://example.com">x</a></h1>') });
    const unsafe = applyDeckEdit(TALK, { kind: "setInline", block: "title", leaf: 0, html: '<a href="javascript:alert(1)">x</a>' });
    expect(unsafe).toEqual({ ok: true, html: swap(TALK, "<h1>Title</h1>", "<h1>x</h1>") });
  });

  it("9.1b replaces the old inline markup of the leaf and keeps the leaf's own tag and attributes", () => {
    const expected = swap(TALK, '<p class="lead">First <i>one</i></p>', '<p class="lead"><u>New</u></p>');
    expect(applyDeckEdit(TALK, { kind: "setInline", block: "body", leaf: 0, html: "<u>New</u>" })).toEqual({ ok: true, html: expected });
  });

  it("9.1b indexes leaves in document order, counting the math leaf", () => {
    const expected = swap(TALK, "<p>Second</p>", "<p><b>2</b></p>");
    expect(applyDeckEdit(TALK, { kind: "setInline", block: "body", leaf: 2, html: "<b>2</b>" })).toEqual({ ok: true, html: expected });
  });

  it("9.1b writes newlines as <br>", () => {
    const expected = swap(TALK, "<h1>Title</h1>", "<h1>a<br>b</h1>");
    expect(applyDeckEdit(TALK, { kind: "setInline", block: "title", leaf: 0, html: "a\nb" })).toEqual({ ok: true, html: expected });
  });

  it("9.1b refuses an unknown block", () => {
    expectRefused(TALK, { kind: "setInline", block: "nope", leaf: 0, html: "x" });
  });

  it("9.1b refuses a leaf index past the end", () => {
    expectRefused(TALK, { kind: "setInline", block: "title", leaf: 1, html: "x" });
  });

  it("9.1b refuses a negative leaf index", () => {
    expectRefused(TALK, { kind: "setInline", block: "title", leaf: -1, html: "x" });
  });

  it("9.1b refuses a math leaf", () => {
    expectRefused(TALK, { kind: "setInline", block: "body", leaf: 1, html: "<b>x</b>" });
  });

  it("9.1b refuses html without a model", () => {
    expectRefused("<p>not a deck</p>", { kind: "setInline", block: "title", leaf: 0, html: "x" });
  });

  it("9.1b leaves setText unchanged", () => {
    const expected = swap(TALK, "<h1>Title</h1>", "<h1>A &amp; B &lt;c&gt; d<br>e</h1>");
    expect(applyDeckEdit(TALK, { kind: "setText", block: "title", leaf: 0, text: "A & B <c> d\ne" })).toEqual({ ok: true, html: expected });
  });
});
