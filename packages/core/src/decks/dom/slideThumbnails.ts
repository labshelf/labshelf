// Slide thumbnails: a SHA-256 key per slide and theme, an LRU cache of data URLs, and a raster of a slide srcdoc through SVG foreignObject onto a 320 px canvas.
import { deriveTextSha256Hex } from "../../hash/index.js";
import { parseDeck } from "../deckParse.js";
import { buildSlideSrcdoc, deckFrameCsp, slideAssetPaths } from "./deckFrame.js";

export interface SlideThumbnailCache { get(key: string): string | undefined; set(key: string, url: string): void; size(): number }

export interface RasterDeps { createCanvas(width: number, height: number): HTMLCanvasElement; loadImage(url: string): Promise<CanvasImageSource> }

const DEFAULT_LIMIT = 200;
const THUMBNAIL_WIDTH = 320;
const IMAGE_TIMEOUT_MS = 5000;
const SVG_NS = "http://www.w3.org/2000/svg";

/** A cache of thumbnail data URLs that drops the least recently used entry (read or written) past its limit. */
export function createThumbnailCache(limit: number = DEFAULT_LIMIT): SlideThumbnailCache {
  const entries = new Map<string, string>();
  return {
    get(key) {
      const url = entries.get(key);
      if (url === undefined) return undefined;
      entries.delete(key);
      entries.set(key, url);
      return url;
    },
    set(key, url) {
      entries.delete(key);
      entries.set(key, url);
      while (entries.size > Math.max(1, limit)) entries.delete(entries.keys().next().value as string);
    },
    size: () => entries.size,
  };
}

/** The cache key of a slide's source under a theme. */
export function thumbnailKey(slideHtml: string, theme: string): Promise<string> {
  return deriveTextSha256Hex(utf8Bytes(`${slideHtml}\u0000${theme}`));
}

/** UTF-8 bytes of a text without TextEncoder, which some DOM hosts lack. */
function utf8Bytes(text: string): Uint8Array {
  const escaped = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < escaped.length; i += 1) {
    if (escaped[i] === "%") {
      bytes.push(parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(escaped.charCodeAt(i));
  }
  return Uint8Array.from(bytes);
}

const defaultDeps: RasterDeps = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage: (url) =>
    new Promise<CanvasImageSource>((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => reject(new Error("The thumbnail image did not load.")), IMAGE_TIMEOUT_MS);
      image.onload = () => {
        clearTimeout(timer);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timer);
        reject(new Error("The thumbnail image failed to load."));
      };
      image.src = url;
    }),
};

/** The srcdoc's styles and body as one XHTML body element, well-formed for an SVG foreignObject. */
function xhtmlBody(srcdoc: string): string {
  const doc = new DOMParser().parseFromString(srcdoc, "text/html");
  const wrapper = doc.createElement("body");
  for (const attribute of Array.from(doc.body.attributes)) wrapper.setAttribute(attribute.name, attribute.value);
  wrapper.append(...Array.from(doc.head.querySelectorAll("style")), ...Array.from(doc.body.childNodes));
  return new XMLSerializer().serializeToString(wrapper);
}

/** The SVG of a slide at its own size: a foreignObject over the whole image holding the srcdoc as XHTML. */
function slideSvg(srcdoc: string, canvas: { width: number; height: number }): string {
  return `<svg xmlns="${SVG_NS}" width="${canvas.width}" height="${canvas.height}"><foreignObject width="100%" height="100%">${xhtmlBody(srcdoc)}</foreignObject></svg>`;
}

/** Rasterises a slide srcdoc (assets already inlined as data URLs) to a PNG data URL 320 px wide; null when the platform cannot. */
export async function renderSlideThumbnail(srcdoc: string, canvas: { width: number; height: number }, deps: RasterDeps = defaultDeps): Promise<string | null> {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return null;
  try {
    const image = await deps.loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(slideSvg(srcdoc, canvas))}`);
    const height = Math.max(1, Math.round((THUMBNAIL_WIDTH * canvas.height) / canvas.width));
    const surface = deps.createCanvas(THUMBNAIL_WIDTH, height);
    const context = surface.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, THUMBNAIL_WIDTH, height);
    return surface.toDataURL("image/png");
  } catch {
    return null;
  }
}

// ---- the srcdoc of one slide for the strip ----

interface SlideSrcdocOptions { html: string; theme: string; slide: number; resolveAsset(path: string): Promise<string>; assetOrigin?: string; inline?: boolean }

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The asset could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** The URL itself, or its content as a data URL (an SVG image cannot load blob: or network URLs); the URL when it cannot be read. */
async function inlineUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  try {
    return await readAsDataUrl(await (await fetch(url)).blob());
  } catch {
    return url;
  }
}

/** The srcdoc of one slide with its assets resolved (as data URLs when `inline`); an asset that does not resolve keeps its reference. */
async function resolveSlideSrcdoc(options: SlideSrcdocOptions): Promise<string> {
  const csp = deckFrameCsp(options.assetOrigin);
  const assets = new Map<string, string>();
  for (const path of slideAssetPaths(options.html, parseDeck(options.html).model, options.slide, options.theme)) {
    try {
      const url = await options.resolveAsset(path);
      assets.set(path, options.inline ? await inlineUrl(url) : url);
    } catch {
      // an asset that does not resolve keeps its relative reference
    }
  }
  return buildSlideSrcdoc(options.html, options.theme, options.slide, { csp, assets });
}

// ---- the thumbnails of a deck ----

export interface DeckThumbnailsOptions {
  /** The deck as it is now; read at each request. */
  deck(): { html: string; theme: string; canvas: { width: number; height: number } };
  resolveAsset(path: string): Promise<string>;
  assetOrigin?: string;
  cache?: SlideThumbnailCache;
  deps?: RasterDeps;
}

export interface DeckThumbnails { thumbnail(index: number): Promise<string | null>; srcdoc(index: number): Promise<string | null> }

/** Thumbnails of a deck's slides through a cache keyed by slide and theme; the srcdoc is the static fallback of a slide that cannot be rasterised. */
export function createDeckThumbnails(options: DeckThumbnailsOptions): DeckThumbnails {
  const cache = options.cache ?? createThumbnailCache();
  const pending = new Map<string, Promise<string | null>>();
  const source = (index: number) => {
    const { html, theme, canvas } = options.deck();
    const range = parseDeck(html).model?.slides[index]?.range;
    return range ? { html, theme, canvas, slide: html.slice(range.from, range.to) } : null;
  };
  const resolve = { resolveAsset: options.resolveAsset, ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) };
  return {
    async thumbnail(index) {
      const found = source(index);
      if (!found) return null;
      // the canvas size is part of the key: a resized deck rasterises again
      const key = await thumbnailKey(found.slide, `${found.theme}\u0000${found.canvas.width}x${found.canvas.height}`);
      const hit = cache.get(key);
      if (hit) return hit;
      let promise = pending.get(key);
      if (!promise) {
        promise = resolveSlideSrcdoc({ html: found.html, theme: found.theme, slide: index, inline: true, ...resolve })
          .then((srcdoc) => renderSlideThumbnail(srcdoc, found.canvas, options.deps))
          .then((url) => {
            if (url) cache.set(key, url);
            return url;
          })
          .catch(() => null)
          .finally(() => pending.delete(key));
        pending.set(key, promise);
      }
      return promise;
    },
    async srcdoc(index) {
      const found = source(index);
      return found ? resolveSlideSrcdoc({ html: found.html, theme: found.theme, slide: index, ...resolve }) : null;
    },
  };
}
