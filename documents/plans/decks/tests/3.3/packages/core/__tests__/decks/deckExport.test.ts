// Tests exportDeckHtml and deckAssetMime (spec 3.3): one offline HTML file with the theme, assets and fonts inlined as data URIs, the base and
// print CSS, math pre-rendered with its TeX in data-tex, one runtime script before </body>, refusal of decks with errors, and no external URL.
// Written as if the file sat at packages/core/__tests__/decks/deckExport.test.ts; relative imports are resolved from there.
import { deckAssetMime, exportDeckHtml, type DeckExportOptions } from "../../src/decks/deckExport.js";
import { deckBaseCss, deckPrintCss } from "../../src/decks/deckLayoutCss.js";
import { scaffoldDeck } from "../../src/decks/deckProject.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { HEAD, SAMPLE_POSTER, SAMPLE_TALK, TALK_ROOT, block, doc, slide, talk } from "./deckSamples.js";

const THEME_LINK = '<link rel="stylesheet" href="theme.css" data-deck-theme>';

const ASSETS = new Map<string, Uint8Array>([
  ["assets/plot.png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])],
  ["assets/plot@2x.webp", Uint8Array.from([82, 73, 70, 70, 9, 8, 7, 6])],
  ["assets/bg.jpg", Uint8Array.from([255, 216, 255, 224, 0, 16])],
  ["assets/icon.gif", Uint8Array.from([71, 73, 70, 56, 57, 97, 4])],
  ["fonts/deck.woff2", Uint8Array.from([119, 79, 70, 50, 0, 1, 0, 0, 5])],
  ["fonts/body.woff", Uint8Array.from([119, 79, 70, 70, 0, 1, 0, 0, 6])],
]);

const MIME: Record<string, string> = {
  "assets/plot.png": "image/png",
  "assets/plot@2x.webp": "image/webp",
  "assets/bg.jpg": "image/jpeg",
  "assets/icon.gif": "image/gif",
  "fonts/deck.woff2": "font/woff2",
  "fonts/body.woff": "font/woff",
};

/** The data URI an asset of the fixture becomes. */
const uri = (path: string): string => `data:${MIME[path]};base64,${Buffer.from(ASSETS.get(path)!).toString("base64")}`;

const readAsset = async (path: string): Promise<Uint8Array | undefined> => ASSETS.get(path);

const THEME_FONT = [
  '@font-face { font-family: "Deck"; src: url("fonts/deck.woff2") format("woff2"); }',
  ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }",
  "",
].join("\n");

const options = (extra: Partial<DeckExportOptions> = {}): DeckExportOptions => ({ theme: THEME_FONT, readAsset, ...extra });

const HEAD_WITH_STYLE = HEAD.replace("</head>", "<style>@font-face{font-family:Body;src:url('fonts/body.woff') format('woff')}</style>\n</head>");

/** A talk with an image, a srcset, a style attribute url() and a style element url() font. */
const ASSET_DECK = doc(
  TALK_ROOT,
  slide(
    [
      block("pic", '<img src="assets/plot.png" srcset="assets/plot.png 1x, assets/plot@2x.webp 2x" alt="Plot">'),
      block("bg", "<p>Backdrop</p>", "left: 120px; top: 400px; width: 400px; height: 200px; background-image: url(assets/bg.jpg);"),
    ].join("\n"),
  ),
  HEAD_WITH_STYLE,
);

const BASE_THEME = /<style data-deck-base>([\s\S]*?)<\/style>\s*<style data-deck-theme>([\s\S]*?)<\/style>/;
const RUNTIME = /<script data-deck-runtime>([\s\S]*?)<\/script>/g;

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** Undoes the spec's splices: drops the runtime script, puts the theme link back for the two styles, and the paths back for the data URIs. */
function unsplice(out: string, paths: string[]): string {
  let text = out.replace(RUNTIME, "").replace(BASE_THEME, THEME_LINK);
  for (const path of paths) text = text.split(uri(path)).join(path);
  return text;
}

describe("deckAssetMime", () => {
  it("3.3b maps each listed extension to its mime type", () => {
    const expected: Array<[string, string]> = [
      ["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.gif", "image/gif"],
      ["a.svg", "image/svg+xml"], ["a.webp", "image/webp"], ["a.avif", "image/avif"], ["a.woff", "font/woff"],
      ["a.woff2", "font/woff2"], ["a.ttf", "font/ttf"], ["a.otf", "font/otf"], ["a.pdf", "application/pdf"],
    ];
    for (const [path, mime] of expected) expect([path, deckAssetMime(path)]).toEqual([path, mime]);
  });

  it("3.3b reads the extension case-insensitively and in folders", () => {
    expect(deckAssetMime("assets/PHOTO.JPG")).toBe("image/jpeg");
    expect(deckAssetMime("fonts/Deck.WOFF2")).toBe("font/woff2");
    expect(deckAssetMime("assets/v1.2/plot.Png")).toBe("image/png");
  });

  it("3.3b gives application/octet-stream for unknown or missing extensions", () => {
    expect(deckAssetMime("assets/data.bin")).toBe("application/octet-stream");
    expect(deckAssetMime("assets/README")).toBe("application/octet-stream");
    expect(deckAssetMime("assets/movie.mp4")).toBe("application/octet-stream");
  });
});

describe("exportDeckHtml: theme and assets", () => {
  it("3.3b replaces the theme link by the base, print and theme styles", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    expect(out).not.toContain(THEME_LINK);
    expect(out).not.toContain('href="theme.css"');
    const match = BASE_THEME.exec(out);
    expect(match).not.toBeNull();
    const size = { w: 1920, h: 1080, unit: "px" } as const;
    expect(match![1]).toBe(`${deckBaseCss(size)}\n${deckPrintCss(size)}`);
    expect(count(out, "<style data-deck-base>")).toBe(1);
    expect(count(out, "<style data-deck-theme>")).toBe(1);
  });

  it("3.3b inlines the theme's url() fonts and keeps its rules", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    const theme = BASE_THEME.exec(out)![2]!;
    expect(theme).toContain(uri("fonts/deck.woff2"));
    expect(theme).not.toContain("fonts/deck.woff2");
    expect(theme).toContain('@font-face { font-family: "Deck"; src: url(');
    expect(theme).toContain(":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }");
  });

  it("3.3b inlines img src and every srcset candidate with the right mime", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    expect(out).toContain(`src="${uri("assets/plot.png")}"`);
    expect(out).toContain(`srcset="${uri("assets/plot.png")} 1x, ${uri("assets/plot@2x.webp")} 2x"`);
  });

  it("3.3b inlines url() in style attributes and style elements", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    expect(out).toContain(uri("assets/bg.jpg"));
    expect(out).not.toContain("assets/bg.jpg");
    expect(out).toContain(uri("fonts/body.woff"));
    expect(out).not.toContain("fonts/body.woff");
  });

  it("3.3b keeps every other byte of the deck", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    expect(unsplice(out, ["assets/plot.png", "assets/plot@2x.webp", "assets/bg.jpg", "fonts/body.woff"])).toBe(ASSET_DECK);
  });

  it("3.3b inlines an SVG image href", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="assets/icon.gif" width="10" height="10"></image></svg>';
    const html = talk(block("icon", svg));
    const out = await exportDeckHtml(html, options());
    expect(out).toContain(`<image href="${uri("assets/icon.gif")}" width="10" height="10">`);
    expect(unsplice(out, ["assets/icon.gif"])).toBe(html);
  });

  it("3.3b keeps a reference readAsset has no bytes for as written", async () => {
    const html = talk(block("pic", '<img src="assets/missing.png" alt="Missing"><img src="assets/plot.png" alt="Plot">'));
    const out = await exportDeckHtml(html, options());
    expect(out).toContain('<img src="assets/missing.png" alt="Missing">');
    expect(out).toContain(`<img src="${uri("assets/plot.png")}" alt="Plot">`);
    expect(unsplice(out, ["assets/plot.png"])).toBe(html);
  });
});

/** The math elements of an output: start-tag attributes, decoded data-tex (or null) and content. */
function mathElements(out: string): Array<{ attributes: string; tex: string | null; content: string }> {
  const found: Array<{ attributes: string; tex: string | null; content: string }> = [];
  const element = /<(span|div)(\s[^>]*\bdata-math\b[^>]*)>([\s\S]*?)<\/\1>/g;
  for (let match = element.exec(out); match; match = element.exec(out)) {
    const attributes = match[2]!;
    const tex = /\sdata-tex\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attributes);
    found.push({ attributes, tex: tex ? decode(tex[1] ?? tex[2] ?? "") : null, content: match[3]! });
  }
  return found;
}

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#92;/g, "\\").replace(/&#x5[cC];/g, "\\").replace(/&amp;/g, "&");

const fakeSvg = (tex: string, display: boolean): string => `<svg data-fake="${encodeURIComponent(tex)}" data-display="${display}"></svg>`;

const MATH_DECK = talk(
  block("m", '<p>Inline <span data-math>a^2</span> and <span data-math>a &lt; b</span></p><div data-math="display">\\frac{a}{b}</div>'),
);

describe("exportDeckHtml: math", () => {
  it("3.3c each math element holds the rendered SVG and its TeX in data-tex", async () => {
    const out = await exportDeckHtml(MATH_DECK, options({ renderMath: fakeSvg }));
    const math = mathElements(out);
    expect(math.map((m) => [m.tex, m.content])).toEqual([
      ["a^2", fakeSvg("a^2", false)],
      ["a < b", fakeSvg("a < b", false)],
      ["\\frac{a}{b}", fakeSvg("\\frac{a}{b}", true)],
    ]);
  });

  it("3.3c renderMath gets the TeX unescaped and display true only for display math", async () => {
    const calls: Array<[string, boolean]> = [];
    await exportDeckHtml(MATH_DECK, options({ renderMath: (tex, display) => { calls.push([tex, display]); return fakeSvg(tex, display); } }));
    expect([...calls].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))).toEqual([["\\frac{a}{b}", true], ["a < b", false], ["a^2", false]]);
  });

  it("3.3c data-tex is added to the start tag, keeping its data-math attribute", async () => {
    const out = await exportDeckHtml(MATH_DECK, options({ renderMath: fakeSvg }));
    const math = mathElements(out);
    expect(math).toHaveLength(3);
    expect(math[2]!.attributes).toMatch(/\sdata-math="display"/);
    for (const m of math) expect(m.attributes).toMatch(/\sdata-tex=/);
  });

  it("3.3c without renderMath the TeX stays as escaped in the deck", async () => {
    const out = await exportDeckHtml(MATH_DECK, options());
    expect(mathElements(out).map((m) => m.content)).toEqual(["a^2", "a &lt; b", "\\frac{a}{b}"]);
    expect(out).not.toContain("<svg");
  });

  it("3.3c when renderMath throws the TeX stays", async () => {
    const out = await exportDeckHtml(MATH_DECK, options({ renderMath: () => { throw new Error("Undefined control sequence"); } }));
    expect(mathElements(out).map((m) => m.content)).toEqual(["a^2", "a &lt; b", "\\frac{a}{b}"]);
  });
});

describe("exportDeckHtml: runtime and errors", () => {
  it("3.3d the runtime script is present once, right before </body>", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    expect(count(out, "<script data-deck-runtime>")).toBe(1);
    expect(count(out, "<script")).toBe(1);
    expect(count(out, "</body>")).toBe(1);
    expect(out).toMatch(/<script data-deck-runtime>[\s\S]*?<\/script><\/body>/);
  });

  it("3.3d the runtime script is under 2 KB, names the navigation keys and handles #print", async () => {
    const out = await exportDeckHtml(ASSET_DECK, options());
    const script = [...out.matchAll(RUNTIME)][0]![1]!;
    expect(Buffer.byteLength(script, "utf8")).toBeLessThan(2048);
    for (const key of ["ArrowRight", "ArrowDown", "PageDown", "ArrowLeft", "ArrowUp", "PageUp", "Home", "End"]) expect(script).toContain(key);
    expect(script).toContain("print");
    expect(script).toContain("hash");
    expect(script).not.toMatch(/https?:|\/\//i);
  });

  it("3.3d a deck with errors rejects naming its error codes", async () => {
    const html = doc('data-deck="talk" data-deck-size="1920x1080px"', slide(`${block("a")}\n<script>alert(1)</script>`));
    const errors = validateDeck(html, { theme: THEME_FONT }).filter((d) => d.severity === "error").map((d) => d.code);
    expect(errors).toEqual(["DECK002", "DECK013"]);
    await expect(exportDeckHtml(html, options())).rejects.toThrow(/^The deck has errors: DECK002, DECK013\.$/);
  });

  it("3.3d an error in the theme rejects too", async () => {
    const theme = 'body { background: url("https://example.org/bg.png"); }\n:root { --deck-bg: #ffffff; }\n';
    expect(validateDeck(ASSET_DECK, { theme }).filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["DECK015"]);
    await expect(exportDeckHtml(ASSET_DECK, options({ theme }))).rejects.toThrow(/^The deck has errors: DECK015\.$/);
  });

  it("3.3d a deck with only warnings exports", async () => {
    const html = talk(block("wide", "<p>Wide</p>", "left: 1800px; top: 80px; width: 400px; height: 200px;"));
    expect(validateDeck(html, { theme: THEME_FONT }).map((d) => d.severity)).toEqual(["warning"]);
    const out = await exportDeckHtml(html, options());
    expect(count(out, "<script data-deck-runtime>")).toBe(1);
  });
});

/** The external references an output holds outside <a href> values, SVG xmlns declarations and data: URIs. */
function externalReferences(out: string): string[] {
  const stripped = out
    .replace(/(<a\b[^>]*?\shref\s*=\s*)("[^"]*"|'[^']*')/gi, '$1""')
    .replace(/\sxmlns(?::[\w-]+)?\s*=\s*"http:\/\/www\.w3\.org\/[^"]*"/g, "")
    .replace(/data:[^"'\s)]*/g, "data:");
  return stripped.match(/https?:|\/\//gi) ?? [];
}

/** Every src, srcset, poster and non-anchor href value that is not a data: URI or a fragment. */
function nonInlineReferences(out: string): string[] {
  const found: string[] = [];
  const tag = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  for (let match = tag.exec(out); match; match = tag.exec(out)) {
    if (match[1]!.toLowerCase() === "a") continue;
    const attribute = /\s(src|srcset|poster|href|xlink:href)\s*=\s*"([^"]*)"/g;
    for (let a = attribute.exec(match[2]!); a; a = attribute.exec(match[2]!)) {
      const values = a[1] === "srcset" ? a[2]!.split(",").map((c) => c.trim().split(/\s+/)[0]!) : [a[2]!];
      for (const value of values) if (!value.startsWith("data:") && !value.startsWith("#")) found.push(value);
    }
  }
  return found;
}

const SAMPLE_THEME = `@font-face { font-family: "Deck"; src: url("fonts/deck.woff2") format("woff2"); }\n${scaffoldDeck("talk", "sample").theme}`;
const MATHJAX_LIKE = (tex: string, display: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-display="${display}" viewBox="0 0 10 10"><title>${encodeURIComponent(tex)}</title></svg>`;
const LINKED_TALK = SAMPLE_TALK.replace("<p>Some text.</p>", '<p>Some text, see <a href="https://example.org/paper">the paper</a>.</p>');

describe("exportDeckHtml: offline single file (A7)", () => {
  it("A7 the sample talk has no external URL outside <a href> and every asset inline", async () => {
    const out = await exportDeckHtml(LINKED_TALK, { theme: SAMPLE_THEME, readAsset, renderMath: MATHJAX_LIKE });
    expect(externalReferences(out)).toEqual([]);
    expect(nonInlineReferences(out)).toEqual([]);
    expect(out).toContain('href="https://example.org/paper"');
    expect(out).toContain(uri("assets/plot.png"));
    expect(out).toContain(uri("fonts/deck.woff2"));
  });

  it("A7 the sample poster has no external URL and every asset inline", async () => {
    const out = await exportDeckHtml(SAMPLE_POSTER, { theme: scaffoldDeck("poster", "sample").theme, readAsset });
    expect(externalReferences(out)).toEqual([]);
    expect(nonInlineReferences(out)).toEqual([]);
    const size = { w: 841, h: 1189, unit: "mm" } as const;
    expect(out).toContain(`<style data-deck-base>${deckBaseCss(size)}\n${deckPrintCss(size)}</style>`);
  });

  it("A7 the export is deterministic for the same input", async () => {
    const talkOptions = { theme: SAMPLE_THEME, readAsset, renderMath: MATHJAX_LIKE };
    expect(await exportDeckHtml(LINKED_TALK, talkOptions)).toBe(await exportDeckHtml(LINKED_TALK, talkOptions));
    const posterOptions = { theme: scaffoldDeck("poster", "sample").theme, readAsset };
    expect(await exportDeckHtml(SAMPLE_POSTER, posterOptions)).toBe(await exportDeckHtml(SAMPLE_POSTER, posterOptions));
  });
});
