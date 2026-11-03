// Where the workspace's nodes are on the page and which node a click hits: SyncTeX boxes through the host's links, else (Typst, or no
// SyncTeX yet) the poster blocks found by their titles in the PDF's text layer; talks then follow by page.
import {
  findSourceDeckNode, findSourceDeckPathAtLine, mapPagesToSlides, matchPosterRects, matchTextRects, plainSourceText, unionSourceDeckRects, readSourceDeckNotes,
  type DeckKind, type SourceDeckFormat, type SourceDeckNode, type SourceDeckPath, type SourceDeckRect,
} from "../../index.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { DeckSourceLinks } from "./types.js";

/** Why the stage follows by page instead of by block; empty while links work. */
type LinkNote = string;

export interface Linking {
  /** Forgets every rectangle and opens the new PDF's text layer; called after each build. */
  reset(pdf: PdfDeck | undefined, tree: readonly SourceDeckNode[], text: string): Promise<void>;
  /** Forgets the rectangles found so far, as an edit moved the nodes' lines and paths. */
  forget(): void;
  /** The node's rectangle, near `page` when given; undefined when it cannot be placed. */
  rectOf(path: SourceDeckPath, tree: readonly SourceDeckNode[], page?: number): Promise<SourceDeckRect | undefined>;
  /** The path of the node at a page point, the deepest one `accept` takes; [] for none. */
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
  synced: boolean | undefined;
}

async function boxesOf(st: LinkState, node: SourceDeckNode, page?: number): Promise<SourceDeckRect | undefined> {
  const { links, pdf } = st;
  if (!links || !pdf) return undefined;
  const boxes = await links.boxes(node.line, node.endLine).catch(() => null);
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

/** Finds each talk slide's elements by their words on the slide's first page. */
async function matchTalk(st: LinkState, pdf: PdfDeck, tree: readonly SourceDeckNode[], text: string): Promise<void> {
  st.slidePages = mapPagesToSlides(pdf.labels, pdf.count, Math.max(readSourceDeckNotes(st.format, text).length, tree.filter((n) => n.kind === "slide").length));
  for (const [s, slide] of tree.entries()) {
    const page = pageOfSlide(st, s);
    if (slide.kind !== "slide" || page === undefined) continue;
    const runs = await pdf.textRuns(page - 1).catch(() => []);
    for (const [id, rect] of matchTextRects(wordsOf(st, text, [s], slide.children ?? []), runs, page)) st.titled.set(id, rect);
  }
}

/** Finds the poster's blocks by their titles, and their elements by words, in the page's text. */
async function matchPoster(st: LinkState, pdf: PdfDeck, tree: readonly SourceDeckNode[], text: string): Promise<void> {
  const runs = await pdf.textRuns(0).catch(() => []);
  const columns = tree.filter((node) => node.kind === "column");
  const rects = matchPosterRects(columns, runs, pdf.pageSize(0));
  columns.forEach((column, c) => (column.children ?? []).forEach((block, b) => {
    const rect = rects.get(block);
    if (rect) st.titled.set(keyOf([c, b]), rect);
    for (const [id, inner] of matchTextRects(wordsOf(st, text, [c, b], block.children ?? []), runs, 1)) st.titled.set(id, inner);
  }));
}

async function reset(st: LinkState, next: PdfDeck | undefined, tree: readonly SourceDeckNode[], text: string): Promise<void> {
  st.pdf = next; st.cache.clear(); st.titled = new Map(); st.synced = undefined;
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

async function pathAt(st: LinkState, point: { page: number; x: number; y: number }, tree: readonly SourceDeckNode[], accept: (node: SourceDeckNode) => boolean): Promise<SourceDeckPath> {
  let linked: SourceDeckPath = [];
  if (st.links) {
    const line = await st.links.sourceAt(point).catch(() => null);
    st.synced = line !== null;
    linked = typeof line === "number" ? findSourceDeckPathAtLine(tree, line, accept) : [];
  }
  // SyncTeX often tags a whole frame or poster with its closing line (beamer, tikzposter); a deeper node found by its words wins.
  let found: SourceDeckPath = [];
  let area = Infinity;
  for (const [id, rect] of st.titled) {
    const path = id.split(".").map(Number);
    const node = findSourceDeckNode(tree, path);
    if (!node || !accept(node) || rect.page !== point.page || point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
    const size = (rect.right - rect.left) * (rect.bottom - rect.top);
    if (path.length > found.length || (path.length === found.length && size < area)) { found = path; area = size; }
  }
  return found.length > linked.length ? found : linked;
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
  const st: LinkState = { format, kind, links, pdf: undefined, slidePages: null, titled: new Map(), cache: new Map(), synced: undefined };
  return {
    reset: (next, tree, text) => reset(st, next, tree, text),
    forget() { st.cache.clear(); },
    rectOf: (path, tree, page) => rectOf(st, path, tree, page),
    pathAt: (point, tree, accept) => pathAt(st, point, tree, accept),
    pageOfSlide: (slide) => pageOfSlide(st, slide),
    slideOfPage(page) { return st.slidePages ? st.slidePages[page - 1] : page - 1; },
    linked: () => Boolean(st.links) && st.synced !== false,
    note: () => noteOf(st),
  };
}
