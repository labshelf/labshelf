// Where the nodes of a source deck tree sit on the built page: the union of a node's SyncTeX boxes (LaTeX), or, without SyncTeX
// (Typst, or before a build wrote one), a block bounded from its title in the PDF's text layer down to the next title in its column.
import type { SourceDeckNode } from "./sourceDeckBlocks.js";

/** A rectangle on a page in PDF points from the page's top-left corner; pages are 1-based. */
export interface SourceDeckRect { page: number; left: number; top: number; right: number; bottom: number }

/** One text run of a page, in PDF points from the page's top-left corner. */
export interface SourceDeckTextRun { text: string; left: number; top: number; width: number; pt: number }

/**
 * The union of the boxes on `page` (or, without one, on the first page that has any), padded by `pad` points;
 * empty boxes and boxes that cover nearly the whole page (enclosing page boxes) are left out. Undefined when none is left.
 */
export function unionSourceDeckRects(boxes: readonly SourceDeckRect[], pageSize: { width: number; height: number }, page?: number, pad = 0): SourceDeckRect | undefined {
  const usable = boxes.filter((box) => box.right > box.left && box.bottom > box.top
    && !(box.right - box.left > pageSize.width * 0.95 && box.bottom - box.top > pageSize.height * 0.9));
  const on = page ?? usable[0]?.page;
  const mine = usable.filter((box) => box.page === on);
  if (on === undefined || mine.length === 0) return undefined;
  return {
    page: on,
    left: Math.max(0, Math.min(...mine.map((box) => box.left)) - pad),
    top: Math.max(0, Math.min(...mine.map((box) => box.top)) - pad),
    right: Math.min(pageSize.width, Math.max(...mine.map((box) => box.right)) + pad),
    bottom: Math.min(pageSize.height, Math.max(...mine.map((box) => box.bottom)) + pad),
  };
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The first unused run, in reading order, whose text is the title, starts with it, or starts it. */
function findTitleRun(runs: readonly SourceDeckTextRun[], title: string, used: ReadonlySet<SourceDeckTextRun>): SourceDeckTextRun | undefined {
  const wanted = normalize(title);
  if (!wanted) return undefined;
  return runs.find((run) => {
    if (used.has(run)) return false;
    const text = normalize(run.text);
    return text.length > 0 && (text === wanted || (text.length >= 3 && wanted.startsWith(text)) || text.startsWith(wanted));
  });
}

/** A poster column found on the page by its blocks' titles, top to bottom. */
interface PlacedColumn {
  titles: Array<{ block: SourceDeckNode; run: SourceDeckTextRun }>;
  /** The top of its first title and of its last one. */
  top: number; lastTop: number;
  /** The x range its titles cover and their middle. */
  x0: number; x1: number; centre: number;
  /** Where the column ends: above the next column under it, the footer line, or the page's foot. */
  bottom: number;
}

const runRight = (run: SourceDeckTextRun): number => run.left + run.width;
const runCentre = (run: SourceDeckTextRun): number => run.left + run.width / 2;

/**
 * The top of the page's footer: the lowest line of text when it sits in the page's last sixth and is set apart from every text above it by
 * more than three of its lines (a footline under the columns). Undefined when the lowest line is a block's own.
 */
function footerTop(ordered: readonly SourceDeckTextRun[], height: number): number | undefined {
  const last = ordered.reduce<SourceDeckTextRun | undefined>((low, run) => (!low || run.top > low.top ? run : low), undefined);
  if (!last || last.top < height * 5 / 6) return undefined;
  const above = ordered.filter((run) => run.top < last.top - last.pt * 0.5);
  const reach = above.length ? Math.max(...above.map((run) => run.top + run.pt)) : 0;
  return last.top - reach > last.pt * 3 ? last.top - last.pt * 0.5 : undefined;
}

/**
 * Where two side-by-side columns part: the widest stretch between their titles' middles that no text of the rows they share covers.
 * Without such a stretch, halfway between their titles.
 */
function columnSplit(a: PlacedColumn, b: PlacedColumn, ordered: readonly SourceDeckTextRun[]): { from: number; to: number } {
  const top = Math.max(a.top, b.top); const bottom = Math.min(a.bottom, b.bottom);
  const spans = ordered.filter((run) => run.top >= top && run.top < bottom && run.left < b.centre && runRight(run) > a.centre)
    .map((run) => [Math.max(run.left, a.centre), Math.min(runRight(run), b.centre)] as const).sort((p, q) => p[0] - q[0]);
  let best: { from: number; to: number } | undefined;
  let reach = a.centre;
  for (const [left, right] of [...spans, [b.centre, b.centre] as const]) {
    if (left > reach && (!best || left - reach > best.to - best.from)) best = { from: reach, to: left };
    reach = Math.max(reach, right);
  }
  const middle = (a.x1 + b.x0) / 2;
  return best ?? { from: middle, to: middle };
}

/**
 * The page rectangles of a poster's blocks (keyed by the block node) found from its text layer. A block is found by its title's run and
 * runs from there to the next found title of its column, or down to the last text of its column. A column runs down from its first title to
 * the first title of another column under it (a full-width block above a row of columns ends where the row starts), else to the footer line
 * or the page's foot; side by side, two columns part at the widest gap their text leaves between their titles, and a block is as wide as its
 * column's text. Blocks whose title is not on the page are left out.
 */
export function matchPosterRects(columns: readonly SourceDeckNode[], runs: readonly SourceDeckTextRun[], pageSize: { width: number; height: number }, page = 1): Map<SourceDeckNode, SourceDeckRect> {
  const ordered = [...runs].sort((a, b) => a.top - b.top || a.left - b.left);
  const used = new Set<SourceDeckTextRun>();
  const placed = columns.flatMap((column): PlacedColumn[] => {
    const titles = (column.children ?? []).filter((node) => node.kind === "block" && node.title).flatMap((block) => {
      const run = findTitleRun(ordered, block.title!, used);
      if (!run) return [];
      used.add(run);
      return [{ block, run }];
    }).sort((a, b) => a.run.top - b.run.top);
    if (!titles.length) return [];
    const x0 = Math.min(...titles.map(({ run }) => run.left)); const x1 = Math.max(...titles.map(({ run }) => runRight(run)));
    return [{ titles, top: titles[0]!.run.top, lastTop: titles[titles.length - 1]!.run.top, x0, x1, centre: (x0 + x1) / 2, bottom: pageSize.height }];
  });
  const foot = footerTop(ordered, pageSize.height) ?? pageSize.height;
  for (const column of placed) {
    const under = placed.filter((other) => other !== column && other.top > column.lastTop && other.x0 < column.x1 && other.x1 > column.x0);
    column.bottom = Math.min(foot, ...under.map((other) => other.top - other.titles[0]!.run.pt * 0.6));
  }
  const besides = (a: PlacedColumn, b: PlacedColumn): boolean => a !== b && a.top < b.bottom && b.top < a.bottom && (b.x0 >= a.x1 || b.x1 <= a.x0);
  const rects = new Map<SourceDeckNode, SourceDeckRect>();
  for (const column of placed) {
    const left = placed.filter((other) => besides(column, other) && other.centre < column.centre).sort((a, b) => b.centre - a.centre)[0];
    const right = placed.filter((other) => besides(column, other) && other.centre > column.centre).sort((a, b) => a.centre - b.centre)[0];
    const leftSplit = left ? columnSplit(left, column, ordered) : undefined;
    const rightSplit = right ? columnSplit(column, right, ordered) : undefined;
    const minX = leftSplit ? (leftSplit.from + leftSplit.to) / 2 : 0;
    const maxX = rightSplit ? (rightSplit.from + rightSplit.to) / 2 : pageSize.width;
    const own = ordered.filter((run) => run.top >= column.top && run.top < column.bottom && runCentre(run) > minX && runCentre(run) < maxX);
    const pad = Math.max(...column.titles.map(({ run }) => run.pt)) * 0.8;
    const x = { left: Math.max(minX, Math.min(...own.map((run) => run.left)) - pad), right: Math.min(maxX, Math.max(...own.map(runRight)) + pad) };
    column.titles.forEach(({ block, run }, i) => {
      const next = column.titles[i + 1]?.run;
      const top = run.top - run.pt * 0.6;
      const below = own.filter((other) => other.top >= run.top);
      const bottom = next ? next.top - next.pt * 0.6 : Math.min(column.bottom, Math.max(...below.map((other) => other.top + other.pt)) + pad);
      rects.set(block, { page, left: Math.max(0, x.left), top: Math.max(0, top), right: Math.min(pageSize.width, x.right), bottom: Math.min(pageSize.height, bottom) });
    });
  }
  return rects;
}

/** The words a reader sees of a node's source: comments, math, command names and group braces dropped. */
export function plainSourceText(format: "latex" | "typst", source: string): string {
  const text = format === "latex"
    ? source.replace(/(^|[^\\])%.*$/gm, "$1").replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " ").replace(/\\(?:begin|end)\s*\{[^}]*\}/g, " ")
      .replace(/\\(?:includegraphics|label|ref|cite|column|usepackage)\b\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ").replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ").replace(/[{}\\&]/g, " ")
    : source.replace(/\/\/.*$/gm, "").replace(/\$[^$]*\$/g, " ").replace(/#[A-Za-z-.]+(\([^)]*\))?/g, " ").replace(/[[\]#*_=+-]/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

/** The gap between two rectangles; 0 when they touch or overlap. */
const gap = (a: SourceDeckRect, b: SourceDeckRect): number =>
  Math.hypot(Math.max(a.left - b.right, 0, b.left - a.right), Math.max(a.top - b.bottom, 0, b.top - a.bottom));

/**
 * The page rectangles of elements found by their words in the text layer: each run of at least four characters goes to the element whose
 * words hold it, and an element's rectangle is the union of its runs. A run more than one element holds (a repeated phrase) goes, after the
 * runs only one element holds, to an element that has not taken that phrase yet, the one whose runs are nearest, else the first.
 * Elements none of whose words are on the page are left out.
 */
export function matchTextRects<K>(elements: ReadonlyArray<{ key: K; words: string }>, runs: readonly SourceDeckTextRun[], page: number, pad = 2): Map<K, SourceDeckRect> {
  const wanted = elements.map(({ key, words }) => ({ key, words: normalize(words) })).filter(({ words }) => words.length >= 4);
  const rects = new Map<K, SourceDeckRect>();
  const taken = new Map<K, Set<string>>();
  const add = (key: K, text: string, rect: SourceDeckRect): void => {
    const known = rects.get(key);
    rects.set(key, known ? { page, left: Math.min(known.left, rect.left), top: Math.min(known.top, rect.top), right: Math.max(known.right, rect.right), bottom: Math.max(known.bottom, rect.bottom) } : rect);
    taken.set(key, (taken.get(key) ?? new Set()).add(text));
  };
  const shared: Array<{ text: string; rect: SourceDeckRect; owners: typeof wanted }> = [];
  for (const run of runs) {
    const text = normalize(run.text);
    if (text.length < 4) continue;
    const owners = wanted.filter(({ words }) => words.includes(text));
    if (owners.length === 0) continue;
    const rect = { page, left: run.left - pad, top: run.top - pad, right: run.left + run.width + pad, bottom: run.top + run.pt * 1.2 + pad };
    if (owners.length === 1) add(owners[0]!.key, text, rect);
    else shared.push({ text, rect, owners });
  }
  for (const { text, rect, owners } of shared) {
    const fresh = owners.filter(({ key }) => !taken.get(key)?.has(text));
    const pool = fresh.length ? fresh : owners;
    let owner = pool[0]!;
    let distance = Infinity;
    for (const candidate of pool) {
      const known = rects.get(candidate.key);
      const away = known ? gap(known, rect) : Infinity;
      if (away < distance) { owner = candidate; distance = away; }
    }
    add(owner.key, text, rect);
  }
  return rects;
}

/**
 * The page rectangles of a block's elements found by their words (as matchTextRects) among the runs whose middle lies in the block's
 * rectangle, each clipped to it: an element never takes words of another block or column, nor leaves its block.
 */
export function matchTextRectsWithin<K>(elements: ReadonlyArray<{ key: K; words: string }>, runs: readonly SourceDeckTextRun[], within: SourceDeckRect, pad = 2): Map<K, SourceDeckRect> {
  const inside = runs.filter((run) => {
    const x = runCentre(run); const y = run.top + run.pt / 2;
    return x >= within.left && x <= within.right && y >= within.top && y <= within.bottom;
  });
  const rects = matchTextRects(elements, inside, within.page, pad);
  for (const [key, rect] of rects) {
    rects.set(key, { page: within.page, left: Math.max(rect.left, within.left), top: Math.max(rect.top, within.top), right: Math.min(rect.right, within.right), bottom: Math.min(rect.bottom, within.bottom) });
  }
  return rects;
}
