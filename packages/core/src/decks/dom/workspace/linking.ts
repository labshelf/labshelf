// Where a built LaTeX deck's pages and poster blocks come from in the source: only the page map LabShelf's build writes, its lines moved
// with the edits made since. A PDF built elsewhere has its pages unlinked, and so has a unit whose line an edit replaced; nothing is guessed.
import { sameSourcePath, type DeckKind, type SourceDeckNode, type SourceDeckPath, type SourceDeckRect } from "../../index.js";
import type { DeckPageMap, DeckPageUnit } from "../../../latex/index.js";

/** A section command that shipped a divider page: its file (absent for the main file) and line. */
export interface PageSection { file?: string; line: number }

/** What a talk's strip and grid list, in page order: a slide by tree index, or a section divider with its first page. */
type PageUnit = { kind: "slide"; index: number } | ({ kind: "section"; page: number } & PageSection);

export interface Linking {
  /** Takes the map of a new build, read against the tree it was built from; undefined unlinks every page. */
  reset(map: DeckPageMap | undefined, tree: readonly SourceDeckNode[]): void;
  /** Links the map again to a tree rebuilt from the same text (an included file was read). */
  relink(tree: readonly SourceDeckNode[]): void;
  /**
   * The main file's text changed from `before` to `after`: the map's main-file lines move with the edit, and a unit whose line the edit
   * replaced is unlinked until the next reset. Call `relink` with the new tree after.
   */
  follow(before: string, after: string): void;
  /** The first page (1-based) a talk's slide shipped. */
  pageOfSlide(slide: number): number | undefined;
  /** The slide a page shows, by tree index. */
  slideOfPage(page: number): number | undefined;
  /** The section divider a page shows. */
  sectionOfPage(page: number): PageSection | undefined;
  /** The first page a section divider shipped. */
  pageOfSection(section: PageSection): number | undefined;
  /** A talk's slides and the section dividers between them, in page order; the tree's slides alone while unlinked. */
  units(): PageUnit[];
  /** A poster block's box on its page (a path inside a block takes the block's); talks have none. */
  rectOf(path: SourceDeckPath): SourceDeckRect | undefined;
  /** The [column, block] path of the smallest poster block box holding the point; [] for none. */
  blockAt(point: { page: number; x: number; y: number }): SourceDeckPath;
}

/** What one reset found: each page's slide or section and each poster block's box. */
interface Linked { slides: Array<number | undefined>; sections: Array<PageSection | undefined>; blocks: Array<{ path: SourceDeckPath; rect: SourceDeckRect }> }

const sameSection = (a: PageSection, b: PageSection): boolean => a.line === b.line && a.file === b.file;

/**
 * Where each 1-based line of `before` is in `after`, by the lines the two share at their start and end: lines before the changed run
 * stay, lines after it shift by the change in line count, and a line inside it is undefined. An edit within lines keeps every line.
 */
function lineMove(before: string, after: string): (line: number) => number | undefined {
  const old = before.split("\n");
  const next = after.split("\n");
  if (old.length === next.length) return (line) => line;
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head++;
  let tail = 0;
  while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  return (line) => (line <= head ? line : line > old.length - tail ? line + next.length - old.length : undefined);
}

export function createLinking(kind: DeckKind, mainPath: string): Linking {
  const folder = mainPath.includes("/") ? mainPath.slice(0, mainPath.lastIndexOf("/") + 1) : "";
  let tree: readonly SourceDeckNode[] = [];
  let map: DeckPageMap | undefined;
  let linked: Linked | undefined;

  /** The project-relative file a map entry names (TeX names it from the main file's folder); undefined for the main file. */
  const fileOf = (file: string): string | undefined => (sameSourcePath(folder + file, mainPath, "/") ? undefined : folder + file);
  const sameFile = (node: SourceDeckNode, file: string | undefined): boolean =>
    file === undefined ? node.file === undefined : node.file !== undefined && sameSourcePath(node.file, file, "/");

  function slideOf(unit: DeckPageUnit): number | undefined {
    const file = fileOf(unit.file);
    const index = tree.findIndex((node) => node.kind === "slide" && node.line === unit.line && sameFile(node, file));
    return index < 0 ? undefined : index;
  }

  function blockOf(file: string, line: number): SourceDeckPath | undefined {
    const at = fileOf(file);
    for (const [c, column] of tree.entries()) {
      const b = (column.children ?? []).findIndex((node) => node.kind === "block" && node.line === line && sameFile(node, at));
      if (column.kind === "column" && b >= 0) return [c, b];
    }
    return undefined;
  }

  function link(): Linked | undefined {
    if (!map) return undefined;
    const slides = map.pages.map((unit) => (unit?.kind === "frame" ? slideOf(unit) : undefined));
    const sections = map.pages.map((unit) => {
      if (unit?.kind !== "section") return undefined;
      const file = fileOf(unit.file);
      return file === undefined ? { line: unit.line } : { file, line: unit.line };
    });
    const blocks = kind === "poster" ? map.blocks.flatMap(({ file, line, page, rect }) => {
      const path = blockOf(file, line);
      return path ? [{ path, rect: { page, ...rect } }] : [];
    }) : [];
    return { slides, sections, blocks };
  }

  return {
    reset(next, nextTree) { map = next; tree = nextTree; linked = link(); },
    relink(nextTree) { tree = nextTree; linked = link(); },
    follow(before, after) {
      if (!map) return;
      const move = lineMove(before, after);
      const moved = <T extends { file: string; line: number }>(entry: T): T | undefined => {
        if (fileOf(entry.file) !== undefined) return entry;
        const line = move(entry.line);
        return line === undefined ? undefined : { ...entry, line };
      };
      map = { pages: map.pages.map((unit) => (unit ? moved(unit) ?? null : null)), blocks: map.blocks.flatMap((block) => moved(block) ?? []) };
    },
    pageOfSlide(slide) { const page = linked?.slides.indexOf(slide) ?? -1; return page < 0 ? undefined : page + 1; },
    slideOfPage: (page) => linked?.slides[page - 1],
    sectionOfPage: (page) => linked?.sections[page - 1],
    pageOfSection(section) { const page = linked?.sections.findIndex((at) => at !== undefined && sameSection(at, section)) ?? -1; return page < 0 ? undefined : page + 1; },
    units() {
      if (!linked) return tree.flatMap((node, index) => (node.kind === "slide" ? [{ kind: "slide", index } as const] : []));
      const units: PageUnit[] = [];
      linked.slides.forEach((slide, i) => {
        const section = linked!.sections[i];
        const last = units.at(-1);
        if (slide !== undefined && !(last?.kind === "slide" && last.index === slide)) units.push({ kind: "slide", index: slide });
        if (section && !(last?.kind === "section" && sameSection(last, section))) units.push({ kind: "section", page: i + 1, ...section });
      });
      // A slide the build did not ship (added since) still lists, after the units of the slides before it.
      for (const [index, node] of tree.entries()) {
        if (node.kind !== "slide" || units.some((unit) => unit.kind === "slide" && unit.index === index)) continue;
        const after = units.findLastIndex((unit) => unit.kind === "slide" && unit.index < index);
        units.splice(after + 1, 0, { kind: "slide", index });
      }
      return units;
    },
    rectOf(path) {
      const key = path.slice(0, 2).join(".");
      return path.length >= 2 ? linked?.blocks.find((block) => block.path.join(".") === key)?.rect : undefined;
    },
    blockAt(point) {
      let best: { path: SourceDeckPath; area: number } | undefined;
      for (const { path, rect } of linked?.blocks ?? []) {
        if (rect.page !== point.page || point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) continue;
        const area = (rect.right - rect.left) * (rect.bottom - rect.top);
        if (!best || area < best.area) best = { path, area };
      }
      return best?.path ?? [];
    },
  };
}
