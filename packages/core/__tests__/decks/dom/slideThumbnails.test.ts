/** @jest-environment jsdom */
/**
 * Spec 6.1: slide thumbnails — thumbnailKey, createThumbnailCache and renderSlideThumbnail, tested through their seams.
 * jsdom has no canvas: renderSlideThumbnail gets injected canvas and image factories; the fake canvas records what is drawn
 * and hands back a fixed PNG data URL.
 */
import { createHash } from "node:crypto";
import { createThumbnailCache, renderSlideThumbnail, thumbnailKey, type RasterDeps } from "../../../src/decks/dom/slideThumbnails";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const SRCDOC = [
  "<!doctype html>",
  '<html lang="en">',
  "<head><meta charset=\"utf-8\"><style>body { margin: 0; }</style></head>",
  "<body>",
  '<section data-slide><div data-block="title"><h1>Hello slide</h1><p>One<br>two</p><img src="data:image/png;base64,AAAA" alt="Plot"></div></section>',
  "</body>",
  "</html>",
].join("\n");

interface FakeCanvas {
  width: number;
  height: number;
  getContext: jest.Mock;
  toDataURL: jest.Mock;
}

interface Harness {
  deps: RasterDeps;
  canvases: FakeCanvas[];
  created: Array<[number, number]>;
  loaded: string[];
  drawn: unknown[][];
  image: object;
}

/** Fake factories. `noContext` makes getContext give null, `tainted` makes toDataURL throw, `loadFails` rejects the image. */
function harness(opts: { noContext?: boolean; tainted?: boolean; loadFails?: boolean } = {}): Harness {
  const canvases: FakeCanvas[] = [];
  const created: Array<[number, number]> = [];
  const loaded: string[] = [];
  const drawn: unknown[][] = [];
  const image = { width: 0, height: 0, tag: "fake-image" };
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop === "drawImage") return (...args: unknown[]) => void drawn.push(args);
      if (!(prop in target)) target[prop] = jest.fn();
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const deps: RasterDeps = {
    createCanvas(width: number, height: number) {
      created.push([width, height]);
      const canvas: FakeCanvas = {
        width,
        height,
        getContext: jest.fn(() => (opts.noContext ? null : context)),
        toDataURL: jest.fn(() => {
          if (opts.tainted) throw new DOMException("The canvas has been tainted by cross-origin data.", "SecurityError");
          return PNG;
        }),
      };
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    },
    async loadImage(url: string) {
      loaded.push(url);
      if (opts.loadFails) throw new Error("image failed to load");
      return image as unknown as CanvasImageSource;
    },
  };
  return { deps, canvases, created, loaded, drawn, image };
}

function decodeDataUrl(url: string): { mime: string; text: string } {
  const comma = url.indexOf(",");
  const meta = url.slice("data:".length, comma);
  const body = url.slice(comma + 1);
  const text = meta.endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
  return { mime: meta.split(";")[0] ?? "", text };
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// --- 6.1c ---------------------------------------------------------------------------------------------------------------------------

describe("thumbnailKey", () => {
  it("6.1c is the SHA-256 hex of the slide html, a NUL and the theme", async () => {
    const slide = '<section data-slide><div data-block="a"><p>Alpha</p></div></section>';
    const theme = ":root { --deck-bg: #ffffff; }\n";
    expect(await thumbnailKey(slide, theme)).toBe(sha256(`${slide}\u0000${theme}`));
  });

  it("6.1c changes when the slide html changes", async () => {
    const theme = ":root { --deck-bg: #ffffff; }\n";
    const a = await thumbnailKey("<section data-slide><p>Alpha</p></section>", theme);
    const b = await thumbnailKey("<section data-slide><p>Beta</p></section>", theme);
    expect(a).not.toBe(b);
  });

  it("6.1c changes when the theme changes", async () => {
    const slide = "<section data-slide><p>Alpha</p></section>";
    const a = await thumbnailKey(slide, ":root { --deck-bg: #ffffff; }\n");
    const b = await thumbnailKey(slide, ":root { --deck-bg: #000000; }\n");
    expect(a).not.toBe(b);
  });

  it("6.1c the same slide and theme give the same key", async () => {
    const slide = "<section data-slide><p>Alpha</p></section>";
    const theme = ":root { --deck-bg: #ffffff; }\n";
    expect(await thumbnailKey(slide, theme)).toBe(await thumbnailKey(slide, theme));
  });
});

describe("createThumbnailCache", () => {
  it("6.1c gives back the url stored under the same key and nothing for an unknown key", () => {
    const cache = createThumbnailCache();
    expect(cache.get("k1")).toBeUndefined();
    cache.set("k1", "data:image/png;base64,ONE");
    expect(cache.get("k1")).toBe("data:image/png;base64,ONE");
    expect(cache.get("k2")).toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  it("6.1c setting a key again replaces its url without growing", () => {
    const cache = createThumbnailCache();
    cache.set("k1", "data:image/png;base64,ONE");
    cache.set("k1", "data:image/png;base64,TWO");
    expect(cache.get("k1")).toBe("data:image/png;base64,TWO");
    expect(cache.size()).toBe(1);
  });

  it("6.1c drops the least recently used entry past its limit", () => {
    const cache = createThumbnailCache(2);
    cache.set("a", "url-a");
    cache.set("b", "url-b");
    expect(cache.get("a")).toBe("url-a"); // a is now more recent than b
    cache.set("c", "url-c");
    expect(cache.size()).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("url-a");
    expect(cache.get("c")).toBe("url-c");
  });

  it("6.1c the default limit is 200 entries", () => {
    const cache = createThumbnailCache();
    for (let i = 0; i < 201; i += 1) cache.set(`k${i}`, `url-${i}`);
    expect(cache.size()).toBe(200);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k1")).toBe("url-1");
    expect(cache.get("k200")).toBe("url-200");
  });
});

// --- 6.1d ---------------------------------------------------------------------------------------------------------------------------

describe("renderSlideThumbnail", () => {
  it("6.1d draws the loaded image on a canvas 320 px wide and returns its PNG data url", async () => {
    const h = harness();
    const url = await renderSlideThumbnail(SRCDOC, { width: 1920, height: 1080 }, h.deps);
    expect(url).toBe(PNG);
    expect(h.created).toEqual([[320, 180]]);
    expect(h.drawn.length).toBeGreaterThan(0);
    expect(h.drawn.every((args) => args[0] === h.image)).toBe(true);
    expect(h.canvases[0]!.toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("6.1d the canvas height is round(320 x H / W)", async () => {
    const h = harness();
    await renderSlideThumbnail(SRCDOC, { width: 1440, height: 1080 }, h.deps);
    await renderSlideThumbnail(SRCDOC, { width: 1000, height: 333 }, h.deps);
    expect(h.created).toEqual([
      [320, 240],
      [320, 107],
    ]);
  });

  it("6.1d loads an image/svg+xml data url of the slide size holding a 100% foreignObject", async () => {
    const h = harness();
    await renderSlideThumbnail(SRCDOC, { width: 1920, height: 1080 }, h.deps);
    expect(h.loaded).toHaveLength(1);
    const { mime, text } = decodeDataUrl(h.loaded[0]!);
    expect(mime).toBe("image/svg+xml");
    const svgTag = /<svg\b[^>]*>/.exec(text)?.[0] ?? "";
    expect(svgTag).toMatch(/xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/);
    expect(svgTag).toMatch(/\bwidth=["']1920["']/);
    expect(svgTag).toMatch(/\bheight=["']1080["']/);
    const foreign = /<foreignObject\b[^>]*>/.exec(text)?.[0] ?? "";
    expect(foreign).toMatch(/\bwidth=["']100%["']/);
    expect(foreign).toMatch(/\bheight=["']100%["']/);
    expect(text.trimEnd()).toMatch(/<\/foreignObject>\s*<\/svg>$/);
  });

  it("6.1d the foreignObject holds the srcdoc body as well-formed XHTML", async () => {
    const h = harness();
    await renderSlideThumbnail(SRCDOC, { width: 1920, height: 1080 }, h.deps);
    const { text } = decodeDataUrl(h.loaded[0]!);
    expect(text).toContain("Hello slide");
    expect(text).toContain("http://www.w3.org/1999/xhtml");
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
    expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(parsed.documentElement.localName).toBe("svg");
  });

  it("6.1d gives null when the image fails to load", async () => {
    const h = harness({ loadFails: true });
    await expect(renderSlideThumbnail(SRCDOC, { width: 1920, height: 1080 }, h.deps)).resolves.toBeNull();
  });

  it("6.1d gives null when the canvas has no 2d context", async () => {
    const h = harness({ noContext: true });
    await expect(renderSlideThumbnail(SRCDOC, { width: 1920, height: 1080 }, h.deps)).resolves.toBeNull();
  });

  it("6.1d gives null when the canvas is tainted", async () => {
    const h = harness({ tainted: true });
    await expect(renderSlideThumbnail(SRCDOC, { width: 1920, height: 1080 }, h.deps)).resolves.toBeNull();
  });
});
