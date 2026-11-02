// Deck frame: one slide rendered in a sandboxed srcdoc iframe (D7) with its CSP, base layout CSS, theme, resolved assets and math, reporting block rects and leaf elements.
import { escapeHtml } from "../../ui/htmlSafety.js";
import { cssReferences, tagReferences, type AssetReference } from "../deckAssetRefs.js";
import { deckBaseCss } from "../deckLayoutCss.js";
import { parseDeck, type DeckBlock, type DeckModel } from "../deckParse.js";
import { tokenizeDeckHtml, type DeckToken } from "../deckTokens.js";

interface BlockRect { id: string; left: number; top: number; width: number; height: number }

interface DeckFrameLeaf{ block: string; index: number; element: HTMLElement }

export type DeckMathLoader = () => Promise<{ renderMathSvg(tex: string, display: boolean): string }>;

export interface DeckFrameOptions { html: string; theme: string; slide: number; resolveAsset(path: string): Promise<string>; loadMath?: DeckMathLoader; assetOrigin?: string }

export interface DeckFrame { frame: HTMLIFrameElement; ready: Promise<void>; blocks(): BlockRect[]; leaves(): DeckFrameLeaf[]; setSlide(index: number): Promise<void>; update(html: string, theme: string): Promise<void>; destroy(): void }

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The D7 frame policy; the asset origin is left out when absent or empty. */
export function deckFrameCsp(assetOrigin?: string): string {
  const origin = assetOrigin ? ` ${assetOrigin}` : "";
  return `default-src 'none'; style-src 'unsafe-inline'${origin}; img-src${origin} data: blob:; font-src${origin} data:`;
}

/** The asset references of a source text (start tags and style element contents), in source order. */
function sourceReferences(text: string, tokens: DeckToken[]): AssetReference[] {
  const out: AssetReference[] = [];
  let previous: DeckToken | undefined;
  for (const token of tokens) {
    if (token.kind === "start") tagReferences(text, token.name, token.attributes, out);
    else if (token.kind === "text" && token.raw && previous?.kind === "start" && previous.name === "style") cssReferences(text, token.range.from, token.text, out);
    previous = token;
  }
  return out;
}

function themeReferences(theme: string): AssetReference[] {
  const out: AssetReference[] = [];
  cssReferences(theme, 0, theme, out);
  return out;
}

/** Replaces each reference that assets holds by its URL. */
function replaceReferences(text: string, references: AssetReference[], assets: ReadonlyMap<string, string>): string {
  let out = "";
  let at = 0;
  for (const { range, path } of [...references].sort((a, b) => a.range.from - b.range.from)) {
    const url = assets.get(path);
    if (url === undefined || range.from < at) continue;
    out += text.slice(at, range.from) + url;
    at = range.to;
  }
  return out + text.slice(at);
}

/** The source text of one slide, its asset references replaced; empty when the slide does not exist. */
function slideSource(html: string, model: DeckModel | undefined, slide: number, assets: ReadonlyMap<string, string>): string {
  const range = model?.slides[slide]?.range;
  if (!range) return "";
  const text = html.slice(range.from, range.to);
  return replaceReferences(text, sourceReferences(text, tokenizeDeckHtml(text).tokens), assets);
}

/** The attribute text of the html start tag, with its leading space; empty when it has none. */
function rootAttributes(html: string, tokens: DeckToken[]): string {
  const root = tokens.find((token): token is Extract<DeckToken, { kind: "start" }> => token.kind === "start" && token.name === "html");
  if (!root || root.attributes.length === 0) return "";
  return ` ${html.slice(root.attributes[0]!.range.from, root.attributes[root.attributes.length - 1]!.range.to)}`;
}

/** The srcdoc of one slide: root attributes, CSP meta, base CSS, theme with assets, and only that slide's source. */
export function buildSlideSrcdoc(html: string, theme: string, slide: number, options: { csp: string; assets: ReadonlyMap<string, string> }): string {
  const { model } = parseDeck(html);
  const base = model?.size ? deckBaseCss(model.size) : "";
  const themed = replaceReferences(theme, themeReferences(theme), options.assets);
  return `<!doctype html><html${rootAttributes(html, tokenizeDeckHtml(html).tokens)}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(options.csp)}"><style data-deck-base>${base}</style><style data-deck-theme>${themed}</style></head><body>${slideSource(html, model, slide, options.assets)}</body></html>`;
}

/** The asset paths of a slide and the theme, each once, in first-reference order. */
function slideAssetPaths(html: string, model: DeckModel | undefined, slide: number, theme: string): string[] {
  const range = model?.slides[slide]?.range;
  const text = range ? html.slice(range.from, range.to) : "";
  const references = [...sourceReferences(text, tokenizeDeckHtml(text).tokens), ...themeReferences(theme)];
  return [...new Set(references.map((reference) => reference.path))];
}

/** Child-index paths from the block element to each of its leaves, read from the block's start tags. */
function leafPaths(html: string, block: DeckBlock): number[][] {
  const starts = new Map(block.leaves.map((leaf, index) => [leaf.range.from, index]));
  const paths: number[][] = [];
  const counters = [0];
  const path: number[] = [];
  const content = html.slice(block.startTag.to, block.range.to);
  for (const token of tokenizeDeckHtml(content).tokens) {
    if (token.kind === "start") {
      const index = counters[counters.length - 1]!;
      counters[counters.length - 1] = index + 1;
      const leaf = starts.get(token.range.from + block.startTag.to);
      if (leaf !== undefined) paths[leaf] = [...path, index];
      if (!token.selfClosing && !VOID_ELEMENTS.has(token.name)) {
        path.push(index);
        counters.push(0);
      }
    } else if (token.kind === "end" && path.length > 0) {
      path.pop();
      counters.pop();
    }
  }
  return paths;
}

function elementAt(root: Element, path: number[] | undefined): Element | null {
  if (!path) return null;
  let node: Element | null = root;
  for (const index of path) node = node?.children[index] ?? null;
  return node;
}

/** Replaces each data-math element's TeX by the loader's SVG; a throwing render keeps the TeX and adds deck-math-error. */
async function renderMath(doc: Document, loadMath: DeckMathLoader | undefined): Promise<void> {
  const elements = Array.from(doc.querySelectorAll<HTMLElement>("[data-math]")).filter((element) => !element.parentElement?.closest("[data-math]"));
  if (!loadMath || elements.length === 0) return;
  const { renderMathSvg } = await loadMath();
  for (const element of elements) {
    const tex = element.textContent ?? "";
    try {
      const display = element.getAttribute("data-math")?.trim().toLowerCase() === "display";
      const parsed = new DOMParser().parseFromString(renderMathSvg(tex, display), "text/html").querySelector("svg");
      if (!parsed) throw new Error("The math renderer returned no SVG");
      element.replaceChildren(doc.importNode(parsed, true));
      element.classList.remove("deck-math-error");
    } catch {
      element.classList.add("deck-math-error");
    }
  }
}

/** Mounts one slide of a deck in a sandboxed iframe appended to host. */
export function mountDeckFrame(host: HTMLElement, options: DeckFrameOptions): DeckFrame {
  const frame = host.ownerDocument.createElement("iframe");
  // PLATFORM: allow-same-origin only, so the parent reads contentDocument while the frame can never run scripts (D7).
  frame.setAttribute("sandbox", "allow-same-origin");
  const csp = deckFrameCsp(options.assetOrigin);
  let html = options.html;
  let theme = options.theme;
  let slide = options.slide;
  let model = parseDeck(html).model;
  let generation = 0;
  let destroyed = false;
  let pendingLoad: (() => void) | null = null;
  host.append(frame);

  /** Resolves on the next load of a frame document built from a srcdoc (an about:blank load holds no base style). */
  const nextLoad = (): Promise<void> => new Promise((resolve) => {
    const onLoad = (): void => {
      if (!frame.contentDocument?.querySelector("style[data-deck-base]")) return;
      frame.removeEventListener("load", onLoad);
      pendingLoad = null;
      resolve();
    };
    pendingLoad = () => {
      frame.removeEventListener("load", onLoad);
      resolve();
    };
    frame.addEventListener("load", onLoad);
  });

  const render = async (): Promise<void> => {
    const current = ++generation;
    pendingLoad?.();
    const assets = new Map<string, string>();
    for (const path of slideAssetPaths(html, model, slide, theme)) {
      try {
        assets.set(path, await options.resolveAsset(path));
      } catch {
        // an asset that does not resolve keeps its relative reference
      }
    }
    if (destroyed || current !== generation) return;
    frame.title = `Slide ${slide + 1}`;
    const loaded = nextLoad();
    frame.setAttribute("srcdoc", buildSlideSrcdoc(html, theme, slide, { csp, assets }));
    await loaded;
    const doc = frame.contentDocument;
    if (destroyed || current !== generation || !doc) return;
    await renderMath(doc, options.loadMath);
  };

  const slideBlocks = (): DeckBlock[] => model?.slides[slide]?.blocks ?? [];

  const deckFrame: DeckFrame = {
    frame,
    ready: render(),
    blocks: () => slideBlocks().flatMap((block) => (block.rect ? [{ id: block.id, ...block.rect }] : [])),
    leaves: () => {
      const section = frame.contentDocument?.body?.querySelector("[data-slide]");
      if (!section) return [];
      const elements = Array.from(section.children).filter((child) => child.hasAttribute("data-block"));
      return slideBlocks().flatMap((block, position) => {
        const element = elements[position];
        if (!element) return [];
        return leafPaths(html, block).flatMap((path, index) => {
          const leaf = elementAt(element, path);
          return leaf ? [{ block: block.id, index, element: leaf as HTMLElement }] : [];
        });
      });
    },
    setSlide: (index) => {
      slide = index;
      return (deckFrame.ready = render());
    },
    update: (nextHtml, nextTheme) => {
      html = nextHtml;
      theme = nextTheme;
      model = parseDeck(html).model;
      return (deckFrame.ready = render());
    },
    destroy: () => {
      destroyed = true;
      pendingLoad?.();
      frame.remove();
    },
  };
  return deckFrame;
}
