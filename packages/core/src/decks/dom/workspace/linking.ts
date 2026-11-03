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

export function createLinking(format: SourceDeckFormat, kind: DeckKind, links: DeckSourceLinks | undefined): Linking {
  let pdf: PdfDeck | undefined;
  let slidePages: number[] | null = null;
  let titled = new Map<string, SourceDeckRect>();
  const cache = new Map<string, Promise<SourceDeckRect | undefined>>();
  let synced: boolean | undefined;
  const key = (path: SourceDeckPath): string => path.join(".");

  const boxesOf = async (node: SourceDeckNode, page?: number): Promise<SourceDeckRect | undefined> => {
    if (!links || !pdf) return undefined;
    const boxes = await links.boxes(node.line, node.endLine).catch(() => null);
    // SyncTeX that holds none of the node's lines (a class that typesets elsewhere, such as tikzposter) does not link it.
    synced = boxes !== null && boxes.length > 0;
    if (!boxes) return undefined;
    return unionSourceDeckRects(boxes, pdf.pageSize((page ?? boxes[0]?.page ?? 1) - 1), page, PAD);
  };

  return {
    async reset(next, tree, text) {
      pdf = next; cache.clear(); titled = new Map(); synced = undefined;
      if (!pdf) { slidePages = null; return; }
      const current = pdf;
      const words = (path: SourceDeckPath, nodes: readonly SourceDeckNode[]): Array<{ key: string; words: string }> => nodes.flatMap((node, i) => [
        ...(node.kind === "columns" || node.kind === "column" ? [] : [{ key: key([...path, i]), words: plainSourceText(format, text.slice(node.range[0], node.range[1])) }]),
        ...words([...path, i], node.children ?? []),
      ]);
      if (kind === "talk") {
        slidePages = mapPagesToSlides(current.labels, current.count, Math.max(readSourceDeckNotes(format, text).length, tree.filter((n) => n.kind === "slide").length));
        // Each slide's elements, found by their words on the slide's first page.
        for (const [s, slide] of tree.entries()) {
          const page = this.pageOfSlide(s);
          if (slide.kind !== "slide" || page === undefined) continue;
          const runs = await current.textRuns(page - 1).catch(() => []);
          for (const [id, rect] of matchTextRects(words([s], slide.children ?? []), runs, page)) titled.set(id, rect);
        }
        return;
      }
      const runs = await current.textRuns(0).catch(() => []);
      const columns = tree.filter((node) => node.kind === "column");
      const rects = matchPosterRects(columns, runs, current.pageSize(0));
      columns.forEach((column, c) => (column.children ?? []).forEach((block, b) => {
        const rect = rects.get(block);
        if (rect) titled.set(key([c, b]), rect);
        for (const [id, inner] of matchTextRects(words([c, b], block.children ?? []), runs, 1)) titled.set(id, inner);
      }));
    },
    forget() { cache.clear(); },
    rectOf(path, tree, page) {
      const id = `${key(path)}@${page ?? ""}`;
      const known = cache.get(id);
      if (known) return known;
      const node = findSourceDeckNode(tree, path);
      const found = (async (): Promise<SourceDeckRect | undefined> => {
        if (!node) return undefined;
        const linked = await boxesOf(node, page);
        if (linked) return linked;
        // Without SyncTeX an element or column takes its block's (or first block's) rectangle.
        for (let length = path.length; length > 0; length--) {
          const rect = titled.get(key(path.slice(0, length)));
          if (rect) return rect;
        }
        return undefined;
      })();
      cache.set(id, found);
      return found;
    },
    async pathAt(point, tree, accept) {
      let linked: SourceDeckPath = [];
      if (links) {
        const line = await links.sourceAt(point).catch(() => null);
        synced = line !== null;
        linked = typeof line === "number" ? findSourceDeckPathAtLine(tree, line, accept) : [];
      }
      // SyncTeX often tags a whole frame or poster with its closing line (beamer, tikzposter); a deeper node found by its words wins.
      let found: SourceDeckPath = [];
      let area = Infinity;
      for (const [id, rect] of titled) {
        const path = id.split(".").map(Number);
        const node = findSourceDeckNode(tree, path);
        if (!node || !accept(node) || rect.page !== point.page || point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
        const size = (rect.right - rect.left) * (rect.bottom - rect.top);
        if (path.length > found.length || (path.length === found.length && size < area)) { found = path; area = size; }
      }
      return found.length > linked.length ? found : linked;
    },
    pageOfSlide(slide) {
      if (!pdf) return undefined;
      if (!slidePages) return slide < pdf.count ? slide + 1 : undefined;
      const page = slidePages.indexOf(slide);
      return page === -1 ? undefined : page + 1;
    },
    slideOfPage(page) { return slidePages ? slidePages[page - 1] : page - 1; },
    linked: () => Boolean(links) && synced !== false,
    note() {
      if (!pdf) return "";
      if (!links) return kind === "poster" ? "Typst has no source links: blocks are found on the page by their titles and words." : "Typst has no source links: elements are found on the slide by their words.";
      if (synced !== false) return "";
      return kind === "poster" ? "SyncTeX does not place this poster's blocks, so they are found on the page by their titles and words."
        : "SyncTeX places only whole slides here, so elements are found on the page by their words.";
    },
  };
}
