// Where the workspace's nodes are on the page and which node a click hits: SyncTeX boxes through the host's links, else (Typst, or no
// SyncTeX yet) the poster blocks found by their titles in the PDF's text layer; talks then follow by page. A talk's pages map to its slides
// through SyncTeX when every slide has boxes, else through the page labels.
import {
  findSourceDeckNode, findSourceDeckPathAtLine, mapPagesToSlides, matchPosterRects, matchTextRects, matchTextRectsWithin, plainSourceText, unionSourceDeckRects,
  type DeckKind, type SourceDeckFormat, type SourceDeckNode, type SourceDeckPath, type SourceDeckRect,
} from "../../index.js";
import { readSourceDeckFrames } from "../../sourceDeckFrames.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { DeckSourceLinks } from "./types.js";

/** Why the stage follows by page instead of by block; empty while links work. */
type LinkNote = string;

export interface Linking {
  /** Forgets every rectangle and opens the new PDF's text layer; called after each build. */
  reset(pdf: PdfDeck | undefined, tree: readonly SourceDeckNode[], text: string): Promise<void>;
  /** Forgets every rectangle found so far (SyncTeX boxes and words on the page), as an edit moved the nodes' lines and paths. */
  forget(): void;
  /** The node's rectangle, near `page` when given; undefined when it cannot be placed. */
  rectOf(path: SourceDeckPath, tree: readonly SourceDeckNode[], page?: number): Promise<SourceDeckRect | undefined>;
  /** The path of the innermost node `accept` takes whose page rectangle holds the point (SyncTeX's line breaks ties and answers when none does); [] for none. */
  pathAt(point: { page: number; x: number; y: number }, tree: readonly SourceDeckNode[], accept: (node: SourceDeckNode) => boolean): Promise<SourceDeckPath>;
  /** The first page of a talk's slide (1-based) by the page labels, or undefined before a build. */
  pageOfSlide(slide: number): number | undefined;
  /** The slide a page shows, by the page labels. */
  slideOfPage(page: number): number | undefined;
  /** Whether nodes are placed through SyncTeX right now. */
  linked(): boolean;
  note(): LinkNote;
}


const PAD = 4;
const keyOf = (path: SourceDeckPath): string => path.join(".");

/** What one linking keeps between calls. */
interface LinkState {
  format: SourceDeckFormat;
  kind: DeckKind;
  links: DeckSourceLinks | undefined;
  pdf: PdfDeck | undefined;
  slidePages: number[] | null;
  titled: Map<string, SourceDeckRect>;
  cache: Map<string, Promise<SourceDeckRect | undefined>>;
  /** Each node's SyncTeX box union on a page, for a click's hit test. */
  boxes: Map<string, Promise<SourceDeckRect | undefined>>;
  synced: boolean | undefined;
}

/** The SyncTeX boxes of a node's lines, in its own file. */
const linesOf = (links: DeckSourceLinks, node: SourceDeckNode): Promise<SourceDeckRect[] | null> =>
  node.file === undefined ? links.boxes(node.line, node.endLine) : links.boxes(node.line, node.endLine, node.file);

async function boxesOf(st: LinkState, node: SourceDeckNode, page?: number): Promise<SourceDeckRect | undefined> {
  const { links, pdf } = st;
  if (!links || !pdf) return undefined;
  const boxes = await linesOf(links, node).catch(() => null);
  // SyncTeX that holds none of the node's lines (a class that typesets elsewhere, such as tikzposter) does not link it.
  st.synced = boxes !== null && boxes.length > 0;
  if (!boxes) return undefined;
  return unionSourceDeckRects(boxes, pdf.pageSize((page ?? boxes[0]?.page ?? 1) - 1), page, PAD);
}

function pageOfSlide(st: LinkState, slide: number): number | undefined {
  const { pdf, slidePages } = st;
  if (!pdf) return undefined;
  if (!slidePages) return slide < pdf.count ? slide + 1 : undefined;
  const page = slidePages.indexOf(slide);
  return page === -1 ? undefined : page + 1;
}

/** The words of each node under `path`, keyed by path, for matching against the page's text. */
function wordsOf(st: LinkState, text: string, path: SourceDeckPath, nodes: readonly SourceDeckNode[]): Array<{ key: string; words: string }> {
  return nodes.flatMap((node, i) => [
    ...(node.kind === "columns" || node.kind === "column" ? [] : [{ key: keyOf([...path, i]), words: plainSourceText(st.format, text.slice(node.range[0], node.range[1])) }]),
    ...wordsOf(st, text, [...path, i], node.children ?? []),
  ]);
}

/**
 * The slide of each page by SyncTeX: a page holding boxes of a frame's lines shows that frame (each of its overlays too), and a page holding
 * none of them (a section divider a theme adds) shows no slide (-1). Null without links or when some slide has no box, as when the build
 * left no SyncTeX file; the page labels decide then.
 */
async function syncedSlidePages(st: LinkState, pdf: PdfDeck, tree: readonly SourceDeckNode[]): Promise<number[] | null> {
  const { links } = st;
  if (!links) return null;
  const found = await Promise.all(tree.map((node) => (node.kind === "slide" ? linesOf(links, node).catch(() => null) : Promise.resolve([]))));
  const pages: number[] = Array.from({ length: pdf.count }, () => -1);
  for (const [slide, boxes] of found.entries()) {
    if (tree[slide]?.kind !== "slide") continue;
    if (!boxes || boxes.length === 0) return null;
    for (const box of boxes) if (box.page >= 1 && box.page <= pdf.count && pages[box.page - 1] === -1) pages[box.page - 1] = slide;
  }
  return pages;
}

/** Finds each talk slide's elements by their words on the slide's first page. */
async function matchTalk(st: LinkState, pdf: PdfDeck, tree: readonly SourceDeckNode[], text: string): Promise<void> {
  st.slidePages = await syncedSlidePages(st, pdf, tree) ?? mapPagesToSlides(pdf.labels, pdf.count, readSourceDeckFrames(st.format, text));
  if (st.pdf !== pdf) return;
  for (const [s, slide] of tree.entries()) {
    const page = pageOfSlide(st, s);
    if (slide.kind !== "slide" || page === undefined) continue;
    const runs = await pdf.textRuns(page - 1).catch(() => []);
    for (const [id, rect] of matchTextRects(wordsOf(st, text, [s], slide.children ?? []), runs, page)) st.titled.set(id, rect);
  }
}

/** Finds the poster's blocks by their titles, and their elements by words inside their block's rectangle (anywhere for a block not found). */
async function matchPoster(st: LinkState, pdf: PdfDeck, tree: readonly SourceDeckNode[], text: string): Promise<void> {
  const runs = await pdf.textRuns(0).catch(() => []);
  const columns = tree.filter((node) => node.kind === "column");
  const rects = matchPosterRects(columns, runs, pdf.pageSize(0));
  columns.forEach((column, c) => (column.children ?? []).forEach((block, b) => {
    const rect = rects.get(block);
    if (rect) st.titled.set(keyOf([c, b]), rect);
    const words = wordsOf(st, text, [c, b], block.children ?? []);
    for (const [id, inner] of rect ? matchTextRectsWithin(words, runs, rect) : matchTextRects(words, runs, 1)) st.titled.set(id, inner);
  }));
}

async function reset(st: LinkState, next: PdfDeck | undefined, tree: readonly SourceDeckNode[], text: string): Promise<void> {
  st.pdf = next; st.cache.clear(); st.boxes.clear(); st.titled = new Map(); st.synced = undefined;
  if (!next) { st.slidePages = null; return; }
  await (st.kind === "talk" ? matchTalk(st, next, tree, text) : matchPoster(st, next, tree, text));
}

function rectOf(st: LinkState, path: SourceDeckPath, tree: readonly SourceDeckNode[], page?: number): Promise<SourceDeckRect | undefined> {
  const id = `${keyOf(path)}@${page ?? ""}`;
  const known = st.cache.get(id);
  if (known) return known;
  const node = findSourceDeckNode(tree, path);
  const found = (async (): Promise<SourceDeckRect | undefined> => {
    if (!node) return undefined;
    const linked = await boxesOf(st, node, page);
    if (linked) return linked;
    // Without SyncTeX an element or column takes its block's (or first block's) rectangle.
    for (let length = path.length; length > 0; length--) {
      const rect = st.titled.get(keyOf(path.slice(0, length)));
      if (rect) return rect;
    }
    return undefined;
  })();
  st.cache.set(id, found);
  return found;
}

type PagePoint = { page: number; x: number; y: number };

const holds = (rect: SourceDeckRect, point: PagePoint): boolean =>
  rect.page === point.page && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

/** The union of the node's SyncTeX boxes on `page`, asked once until the next reset or forget; it leaves `synced` alone. */
function boxRectOf(st: LinkState, path: SourceDeckPath, node: SourceDeckNode, page: number): Promise<SourceDeckRect | undefined> {
  const id = `${keyOf(path)}@${page}`;
  const known = st.boxes.get(id);
  if (known) return known;
  const { links, pdf } = st;
  const found = links && pdf
    ? linesOf(links, node).then((boxes) => (boxes ? unionSourceDeckRects(boxes, pdf.pageSize(page - 1), page, PAD) : undefined), () => undefined)
    : Promise.resolve(undefined);
  st.boxes.set(id, found);
  return found;
}

/** A node `accept` takes: whether it has a rectangle on the point's page, and the area of the smallest one holding the point. */
interface Hit { path: SourceDeckPath; placed: boolean; area: number | undefined }

/** The hits under `path`; `only` keeps one of `nodes` (a talk's shown slide). */
async function hitsOf(st: LinkState, point: PagePoint, nodes: readonly SourceDeckNode[], path: SourceDeckPath, accept: (node: SourceDeckNode) => boolean, only?: number): Promise<Hit[]> {
  const found = await Promise.all(nodes.map(async (node, i): Promise<Hit[]> => {
    if (only !== undefined && i !== only) return [];
    const at = [...path, i];
    const inner = hitsOf(st, point, node.children ?? [], at, accept);
    if (!accept(node)) return inner;
    const rects = [await boxRectOf(st, at, node, point.page), st.titled.get(keyOf(at))].filter((rect): rect is SourceDeckRect => rect !== undefined && rect.page === point.page);
    const inside = rects.filter((rect) => holds(rect, point)).map((rect) => (rect.right - rect.left) * (rect.bottom - rect.top));
    return [{ path: at, placed: rects.length > 0, area: inside.length ? Math.min(...inside) : undefined }, ...(await inner)];
  }));
  return found.flat();
}

const startsWith = (path: SourceDeckPath, prefix: SourceDeckPath): boolean => prefix.every((index, i) => path[i] === index);

/**
 * The innermost node whose page rectangle (its SyncTeX boxes or its words found on the page) holds the point; among equally deep ones the
 * smallest, then the one on SyncTeX's line. SyncTeX tags content with the line of the token that ended it (the next block, \column or \end), so
 * its line only breaks ties, names a deeper node that has no rectangle of its own, or answers when no rectangle holds the point.
 */
async function pathAt(st: LinkState, point: PagePoint, tree: readonly SourceDeckNode[], accept: (node: SourceDeckNode) => boolean): Promise<SourceDeckPath> {
  let linked: SourceDeckPath = [];
  if (st.links) {
    const found = await st.links.sourceAt(point).catch(() => null);
    st.synced = found !== null;
    // A hit carries its file; only that file's nodes hold its line.
    const hit = typeof found === "number" ? { line: found, file: undefined } : found ?? undefined;
    linked = hit ? findSourceDeckPathAtLine(tree, hit.line, (node) => node.file === hit.file && accept(node)) : [];
  }
  if (!st.pdf) return linked;
  // A talk's page shows one slide: only its nodes are placed.
  const slide = st.kind === "talk" ? (st.slidePages ? st.slidePages[point.page - 1] ?? -1 : point.page - 1) : undefined;
  const hits = await hitsOf(st, point, tree, [], accept, slide);
  const onLine = (path: SourceDeckPath): boolean => linked.length > 0 && startsWith(linked, path);
  let best: { path: SourceDeckPath; area: number } | undefined;
  for (const { path, area } of hits) {
    if (area === undefined) continue;
    const better = !best || path.length > best.path.length
      || (path.length === best.path.length && (area < best.area || (area === best.area && onLine(path) && !onLine(best.path))));
    if (better) best = { path, area };
  }
  if (!best) return linked;
  const linkedPlaced = hits.some((hit) => hit.placed && keyOf(hit.path) === keyOf(linked));
  return linked.length > best.path.length && startsWith(linked, best.path) && !linkedPlaced ? linked : best.path;
}

function noteOf(st: LinkState): LinkNote {
  const { pdf, links, kind, synced } = st;
  if (!pdf) return "";
  if (!links) return kind === "poster" ? "Typst has no source links: blocks are found on the page by their titles and words." : "Typst has no source links: elements are found on the slide by their words.";
  if (synced !== false) return "";
  return kind === "poster" ? "SyncTeX does not place this poster's blocks, so they are found on the page by their titles and words."
    : "SyncTeX places only whole slides here, so elements are found on the page by their words.";
}

export function createLinking(format: SourceDeckFormat, kind: DeckKind, links: DeckSourceLinks | undefined): Linking {
  const st: LinkState = { format, kind, links, pdf: undefined, slidePages: null, titled: new Map(), cache: new Map(), boxes: new Map(), synced: undefined };
  return {
    reset: (next, tree, text) => reset(st, next, tree, text),
    // Every rectangle is keyed by a path of the old tree: none may place a node of the edited one before the rebuild.
    forget() { st.cache.clear(); st.boxes.clear(); st.titled = new Map(); },
    rectOf: (path, tree, page) => rectOf(st, path, tree, page),
    pathAt: (point, tree, accept) => pathAt(st, point, tree, accept),
    pageOfSlide: (slide) => pageOfSlide(st, slide),
    slideOfPage(page) { return st.slidePages ? st.slidePages[page - 1] : page - 1; },
    linked: () => Boolean(st.links) && st.synced !== false,
    note: () => noteOf(st),
  };
}
