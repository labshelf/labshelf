/** @jest-environment jsdom */
/**
 * Spec 5.1: the deck frame — deckFrameCsp, buildSlideSrcdoc and mountDeckFrame rendering one slide in a sandboxed srcdoc iframe.
 * jsdom has no layout and does not load srcdoc: the harness below plays the browser's part. When a connected iframe gets a srcdoc,
 * it parses that srcdoc into the frame's contentDocument and fires one load on the frame, as a browser does; jsdom's own
 * about:blank load is held back so it never stands in for the srcdoc load. Geometry is read from the model; the math loader is a jest mock.
 */
import { deckBaseCss } from "../../../src/decks/deckLayoutCss";
import { parseDeckSize } from "../../../src/decks/deckSizes";
import { buildSlideSrcdoc, deckFrameCsp, mountDeckFrame, type DeckFrame, type DeckFrameOptions } from "../../../src/decks/dom/deckFrame";

const ROOT = 'lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px"';

function deckHtml(slides: string[]): string {
  return [
    "<!doctype html>",
    `<html ${ROOT}>`,
    "<head>",
    '<meta charset="utf-8">',
    "<title>Frame sample</title>",
    '<link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    ...slides.map((inner) => `<section data-slide>\n${inner}\n</section>`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const SLIDE_0 = [
  '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>',
  "<aside data-notes>Say hello.</aside>",
].join("\n");
const SLIDE_1 = [
  '<div data-block="body" style="left: 120px; top: 320px; width: 1000px; height: 600px;"><p>Some text.</p><div data-math="display">\\frac{a}{b}</div><img src="assets/plot.png" alt="Plot"></div>',
  '<div data-block="side" style="left: 1200px; top: 320px; width: 600px; height: 300px;"><p>Inline <span data-math>x^2</span> here.</p><p>Second.</p></div>',
].join("\n");
const SLIDE_2 = [
  '<div data-block="placed" style="left: 10px; top: 20px; width: 300px; height: 40px;"><p>Placed.</p></div>',
  '<div data-block="loose"><p>Loose.</p></div>',
].join("\n");

const DECK = deckHtml([SLIDE_0, SLIDE_1, SLIDE_2]);
const THEME = ':root { --deck-bg: #ffffff; }\n.logo { background: url("assets/logo.png"); }\n';
const ASSETS: ReadonlyMap<string, string> = new Map([
  ["assets/logo.png", "blob:null/logo"],
  ["assets/plot.png", "blob:null/plot"],
]);
const CSP = deckFrameCspText("https://assets.example");

/** The D7 policy as the spec words it, written out here so the test does not depend on deckFrameCsp for its expectations. */
function deckFrameCspText(origin: string): string {
  return `default-src 'none'; style-src 'unsafe-inline' ${origin}; img-src ${origin} data: blob:; font-src ${origin} data:`;
}

const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

// --- srcdoc harness: jsdom stands in for the browser's srcdoc loading ---

const suppressNativeLoad = (event: Event): void => {
  if (event.isTrusted && event.target instanceof HTMLIFrameElement) event.stopImmediatePropagation();
};

function loadSrcdoc(frame: HTMLIFrameElement): void {
  setTimeout(() => {
    const srcdoc = frame.getAttribute("srcdoc");
    const doc = frame.contentDocument;
    if (!frame.isConnected || srcdoc === null || !doc) return;
    const parsed = parse(srcdoc);
    doc.replaceChild(doc.importNode(parsed.documentElement, true), doc.documentElement);
    frame.dispatchEvent(new Event("load"));
  }, 0);
}

const observer = new MutationObserver((records) => {
  const frames = new Set<HTMLIFrameElement>();
  for (const record of records) {
    if (record.type === "attributes" && record.target instanceof HTMLIFrameElement) frames.add(record.target);
    for (const node of Array.from(record.addedNodes)) {
      if (node instanceof HTMLIFrameElement) frames.add(node);
      if (node instanceof Element) node.querySelectorAll("iframe").forEach((frame) => frames.add(frame));
    }
  }
  frames.forEach(loadSrcdoc);
});

beforeAll(() => {
  document.addEventListener("load", suppressNativeLoad, true);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["srcdoc"] });
});

afterAll(() => {
  observer.disconnect();
  document.removeEventListener("load", suppressNativeLoad, true);
});

// --- mounting ---

let host: HTMLElement;
let frames: DeckFrame[] = [];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  frames = [];
});

afterEach(() => {
  for (const frame of frames) {
    try {
      frame.destroy();
    } catch {
      // already destroyed
    }
  }
  host.remove();
});

function mathLoader(render: (tex: string, display: boolean) => string = (tex) => `<svg xmlns="http://www.w3.org/2000/svg" data-rendered="${tex.length}" viewBox="0 0 10 10"></svg>`) {
  const renderMathSvg = jest.fn(render);
  const loadMath = jest.fn(() => Promise.resolve({ renderMathSvg }));
  return { renderMathSvg, loadMath };
}

async function mount(overrides: Partial<DeckFrameOptions> = {}): Promise<DeckFrame> {
  const options: DeckFrameOptions = {
    html: DECK,
    theme: THEME,
    slide: 1,
    resolveAsset: jest.fn((path: string) => Promise.resolve(`blob:test/${path}`)),
    loadMath: mathLoader().loadMath,
    assetOrigin: "https://assets.example",
    ...overrides,
  };
  const frame = mountDeckFrame(host, options);
  frames.push(frame);
  await frame.ready;
  return frame;
}

const doc = (frame: DeckFrame): Document => {
  const contentDocument = frame.frame.contentDocument;
  if (!contentDocument) throw new Error("the frame has no contentDocument");
  return contentDocument;
};

const leafSummary = (frame: DeckFrame) => frame.leaves().map((leaf) => ({ block: leaf.block, index: leaf.index, tag: leaf.element.tagName.toLowerCase() }));

// --- 5.1a ---

describe("deckFrameCsp", () => {
  it("5.1a gives the D7 policy with an asset origin", () => {
    expect(deckFrameCsp("https://file+.vscode-resource.vscode-cdn.net")).toBe(
      "default-src 'none'; style-src 'unsafe-inline' https://file+.vscode-resource.vscode-cdn.net; img-src https://file+.vscode-resource.vscode-cdn.net data: blob:; font-src https://file+.vscode-resource.vscode-cdn.net data:",
    );
  });

  it("5.1a leaves the origin out, with single spaces, when no asset origin is given", () => {
    expect(deckFrameCsp()).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
  });

  it("5.1a treats an empty asset origin as absent", () => {
    expect(deckFrameCsp("")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
  });
});

// --- 5.1b ---

describe("buildSlideSrcdoc", () => {
  const srcdoc = (): string => buildSlideSrcdoc(DECK, THEME, 1, { csp: CSP, assets: ASSETS });

  it("5.1b starts with the doctype and an html start tag carrying the deck's root attributes", () => {
    const text = srcdoc();
    expect(text.startsWith("<!doctype html><html")).toBe(true);
    const root = parse(text).documentElement;
    expect(root.getAttribute("lang")).toBe("en");
    expect(root.getAttribute("data-deck")).toBe("talk");
    expect(root.getAttribute("data-deck-version")).toBe("1");
    expect(root.getAttribute("data-deck-size")).toBe("1920x1080px");
  });

  it("5.1b opens head with the charset meta and then the CSP meta", () => {
    expect(srcdoc()).toContain('><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="');
  });

  it("5.1b carries the CSP text in the CSP meta's content", () => {
    const meta = parse(srcdoc()).querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta?.getAttribute("content")).toBe(CSP);
  });

  it("5.1b attribute-escapes the CSP text", () => {
    const csp = `default-src 'none'; style-src "x" <y> & z`;
    const text = buildSlideSrcdoc(DECK, THEME, 1, { csp, assets: ASSETS });
    expect(text).not.toContain(csp);
    expect(parse(text).querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(csp);
  });

  it("5.1b holds the base layout CSS of the deck size in a data-deck-base style", () => {
    const size = parseDeckSize("1920x1080px");
    if (!size) throw new Error("size did not parse");
    expect(srcdoc()).toContain(`<style data-deck-base>${deckBaseCss(size)}</style><style data-deck-theme>`);
  });

  it("5.1b holds the theme in a data-deck-theme style with its relative url() replaced from assets", () => {
    const theme = parse(srcdoc()).querySelector("style[data-deck-theme]")?.textContent ?? "";
    expect(theme).toContain(":root { --deck-bg: #ffffff; }");
    expect(theme).toContain("blob:null/logo");
    expect(theme).not.toContain("assets/logo.png");
  });

  it("5.1b ends head after the theme style and closes the document after the slide", () => {
    const text = srcdoc();
    expect(text).toMatch(/<\/style><\/head><body>/);
    expect(text.endsWith("</body></html>")).toBe(true);
  });

  it("5.1b holds only the chosen slide", () => {
    const body = parse(srcdoc()).body;
    expect(body.querySelectorAll("[data-slide]")).toHaveLength(1);
    expect(Array.from(body.querySelectorAll("[data-block]")).map((el) => el.getAttribute("data-block"))).toEqual(["body", "side"]);
    expect(body.textContent).toContain("Some text.");
    expect(body.textContent).not.toContain("Title");
    expect(body.textContent).not.toContain("Placed.");
  });

  it("5.1b leaves the deck's own head out", () => {
    const text = srcdoc();
    expect(text).not.toContain("Frame sample");
    expect(text).not.toContain('href="theme.css"');
    expect(parse(text).querySelectorAll("link")).toHaveLength(0);
  });

  it("5.1b replaces an asset reference of the slide by its asset URL", () => {
    const text = srcdoc();
    expect(parse(text).querySelector("img")?.getAttribute("src")).toBe("blob:null/plot");
    expect(text).not.toContain("assets/plot.png");
  });

  it("5.1b keeps an asset reference that assets does not hold", () => {
    const text = buildSlideSrcdoc(DECK, THEME, 1, { csp: CSP, assets: new Map() });
    expect(parse(text).querySelector("img")?.getAttribute("src")).toBe("assets/plot.png");
  });

  it("5.1b keeps the slide's math as TeX source", () => {
    const math = parse(srcdoc()).querySelector('[data-math="display"]');
    expect(math?.textContent).toBe("\\frac{a}{b}");
  });

  it("5.1b builds another slide when asked for it", () => {
    const body = parse(buildSlideSrcdoc(DECK, THEME, 0, { csp: CSP, assets: ASSETS })).body;
    expect(body.querySelectorAll("[data-slide]")).toHaveLength(1);
    expect(body.querySelector("h1")?.textContent).toBe("Title");
    expect(body.textContent).not.toContain("Some text.");
  });

  it("5.1b the mounted frame's srcdoc carries the CSP of its asset origin and resolved asset URLs", async () => {
    const resolveAsset = jest.fn((path: string) => Promise.resolve(`blob:test/${path}`));
    const frame = await mount({ resolveAsset, assetOrigin: "https://assets.example" });
    const built = parse(frame.frame.getAttribute("srcdoc") ?? "");
    expect(built.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(deckFrameCsp("https://assets.example"));
    expect(resolveAsset).toHaveBeenCalledWith("assets/plot.png");
    expect(built.querySelector("img")?.getAttribute("src")).toBe("blob:test/assets/plot.png");
  });
});

// --- 5.1c ---

describe("mountDeckFrame frame", () => {
  it("5.1c appends one iframe to the host and hands it back", async () => {
    const frame = await mount();
    const found = host.querySelectorAll("iframe");
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(frame.frame);
  });

  it("5.1c sandboxes the iframe with allow-same-origin only, never allow-scripts", async () => {
    const frame = await mount();
    expect(frame.frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("5.1c titles the iframe with the 1-based slide number", async () => {
    const frame = await mount({ slide: 1 });
    expect(frame.frame.title).toBe("Slide 2");
  });

  it("5.1c after ready, display and inline math hold the loader's SVG", async () => {
    const { loadMath, renderMathSvg } = mathLoader();
    const frame = await mount({ loadMath });
    const display = doc(frame).querySelector('[data-math="display"]');
    const inline = doc(frame).querySelector("span[data-math]");
    expect(display?.querySelector("svg")).not.toBeNull();
    expect(inline?.querySelector("svg")).not.toBeNull();
    expect(display?.textContent).not.toContain("\\frac");
    expect(inline?.textContent).not.toContain("x^2");
    expect(renderMathSvg).toHaveBeenCalledWith("\\frac{a}{b}", true);
    expect(renderMathSvg).toHaveBeenCalledWith("x^2", false);
  });

  it("5.1c a math render that throws leaves the TeX and adds deck-math-error", async () => {
    const { loadMath } = mathLoader((tex) => {
      if (tex === "x^2") throw new Error("bad TeX");
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
    });
    const frame = await mount({ loadMath });
    const inline = doc(frame).querySelector("span[data-math]");
    expect(inline?.textContent).toBe("x^2");
    expect(inline?.classList.contains("deck-math-error")).toBe(true);
    const display = doc(frame).querySelector('[data-math="display"]');
    expect(display?.querySelector("svg")).not.toBeNull();
    expect(display?.classList.contains("deck-math-error")).toBe(false);
  });
});

// --- 5.1d ---

describe("mountDeckFrame model and lifecycle", () => {
  it("5.1d blocks() gives the slide's blocks with their model rects in source order", async () => {
    const frame = await mount({ slide: 1 });
    expect(frame.blocks()).toEqual([
      { id: "body", left: 120, top: 320, width: 1000, height: 600 },
      { id: "side", left: 1200, top: 320, width: 600, height: 300 },
    ]);
  });

  it("5.1d blocks() leaves out a block without a rect", async () => {
    const frame = await mount({ slide: 2 });
    expect(frame.blocks()).toEqual([{ id: "placed", left: 10, top: 20, width: 300, height: 40 }]);
  });

  it("5.1d leaves() gives each block's leaf elements in order with their leaf index", async () => {
    const frame = await mount({ slide: 1 });
    expect(leafSummary(frame)).toEqual([
      { block: "body", index: 0, tag: "p" },
      { block: "body", index: 1, tag: "div" },
      { block: "side", index: 0, tag: "p" },
      { block: "side", index: 1, tag: "p" },
    ]);
  });

  it("5.1d leaves() elements live in the frame's document and are the slide's own elements", async () => {
    const frame = await mount({ slide: 1 });
    const leaves = frame.leaves();
    for (const leaf of leaves) expect(leaf.element.ownerDocument).toBe(doc(frame));
    expect(leaves[0]?.element.textContent).toBe("Some text.");
    expect(leaves[1]?.element.getAttribute("data-math")).toBe("display");
    expect(leaves[1]?.element.closest("[data-block]")?.getAttribute("data-block")).toBe("body");
    expect(leaves[3]?.element.textContent).toBe("Second.");
  });

  it("5.1d setSlide re-renders the frame with the other slide", async () => {
    const frame = await mount({ slide: 1 });
    await frame.setSlide(0);
    expect(doc(frame).querySelector("h1")?.textContent).toBe("Title");
    expect(doc(frame).body.textContent).not.toContain("Some text.");
    expect(frame.blocks()).toEqual([{ id: "title", left: 120, top: 80, width: 1680, height: 200 }]);
    expect(leafSummary(frame)).toEqual([{ block: "title", index: 0, tag: "h1" }]);
  });

  it("5.1d update re-renders the frame with the new html and theme", async () => {
    const frame = await mount({ slide: 1 });
    const html = DECK.replace("<p>Some text.</p>", "<p>Changed text.</p>").replace("width: 1000px", "width: 900px");
    await frame.update(html, ":root { --deck-bg: #000000; }\n");
    expect(doc(frame).body.textContent).toContain("Changed text.");
    expect(doc(frame).body.textContent).not.toContain("Some text.");
    expect(doc(frame).querySelector("style[data-deck-theme]")?.textContent).toContain("#000000");
    expect(frame.blocks()[0]).toEqual({ id: "body", left: 120, top: 320, width: 900, height: 600 });
    expect(frame.leaves()[0]?.element.textContent).toBe("Changed text.");
  });

  it("5.1d destroy removes the frame from the host", async () => {
    const frame = await mount();
    frame.destroy();
    expect(host.querySelector("iframe")).toBeNull();
    expect(frame.frame.isConnected).toBe(false);
  });
});
