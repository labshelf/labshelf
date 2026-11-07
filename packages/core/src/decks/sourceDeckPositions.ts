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

/**
 * The page rectangles of a poster's blocks (keyed by the block node) found from its text layer: each block runs from its title's run
 * to above the next found title of its column, or down to the column's last text; its width is its column's. Blocks whose title is
 * not on the page are left out. A column spans the text runs nearest its titles' centre.
 */
export function matchPosterRects(columns: readonly SourceDeckNode[], runs: readonly SourceDeckTextRun[], pageSize: { width: number; height: number }, page = 1): Map<SourceDeckNode, SourceDeckRect> {
  const ordered = [...runs].sort((a, b) => a.top - b.top || a.left - b.left);
  const used = new Set<SourceDeckTextRun>();
  const found = columns.map((column) => (column.children ?? []).filter((node) => node.kind === "block" && node.title).flatMap((block) => {
    const run = findTitleRun(ordered, block.title!, used);
    if (!run) return [];
    used.add(run);
    return [{ block, run }];
  }));
  // Each run belongs to the column whose titles' centre is nearest, so a column spans its own text even when titles are centred.
  const centres = found.map((titles) => (titles.length ? titles.reduce((sum, { run }) => sum + run.left + run.width / 2, 0) / titles.length : undefined));
  const columnOf = (run: SourceDeckTextRun): number => {
    let best = -1; let distance = Infinity;
    centres.forEach((centre, c) => { if (centre !== undefined && Math.abs(run.left + run.width / 2 - centre) < distance) { best = c; distance = Math.abs(run.left + run.width / 2 - centre); } });
    return best;
  };
  const rects = new Map<SourceDeckNode, SourceDeckRect>();
  found.forEach((titles, c) => {
    if (!titles.length) return;
    const sorted = [...titles].sort((a, b) => a.run.top - b.run.top);
    const first = sorted[0]!.run.top;
    const inColumn = ordered.filter((run) => run.top >= first && columnOf(run) === c);
    const pad = Math.max(...sorted.map(({ run }) => run.pt)) * 0.8;
    const left = Math.min(...inColumn.map((run) => run.left)) - pad;
    const right = Math.max(...inColumn.map((run) => run.left + run.width)) + pad;
    sorted.forEach(({ block, run }, i) => {
      const next = sorted[i + 1]?.run;
      const below = inColumn.filter((other) => other.top >= run.top && (!next || other.top < next.top));
      const bottom = next ? next.top - next.pt * 0.4 : Math.max(...below.map((other) => other.top + other.pt)) + pad;
      rects.set(block, { page, left: Math.max(0, left), top: Math.max(0, run.top - run.pt * 0.6), right: Math.min(pageSize.width, right), bottom: Math.min(pageSize.height, bottom) });
    });
  });
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
