/** Print check of a poster: a pure module (no DOM, no pdfjs) that turns the measured page, text boxes and image placements, all in mm from the page's top left, into print issues: image DPI at print size, items in the safe margin, and underfill. It never throws; non-finite or non-positive sizes are skipped. */

/** Images below this many dots per inch at their print size are flagged. */
export const PRINT_MIN_DPI = 150;
/** Items closer than this (mm) to a page edge are flagged. */
export const PRINT_SAFE_MARGIN_MM = 10;
/** Content filling less than this share of the page height or width is flagged as underfill. */
export const PRINT_MIN_FILL = 0.7;

/** Share of the page that makes an item a band (one dimension) or a background (both). */
const BAND_SHARE = 0.9;
const MM_PER_INCH = 25.4;

export interface PrintBox { left: number; top: number; width: number; height: number }

export interface PrintItem { box: PrintBox; block: string; index: number }

export interface PrintImage extends PrintItem { pixelWidth: number; pixelHeight: number }

export interface PrintCheckInput { page: { width: number; height: number }; texts: PrintItem[]; images: PrintImage[] }

export type PrintEdge = "top" | "right" | "bottom" | "left";

export type PrintIssue = { kind: "lowDpi"; block: string; index: number; dpi: number; box: PrintBox } | { kind: "margin"; edge: PrintEdge; count: number; distance: number; block: string; index: number; box: PrintBox } | { kind: "underfill"; dimension: "height" | "width"; filled: number; empty: PrintEdge; box: PrintBox }

const EDGES: PrintEdge[] = ["top", "right", "bottom", "left"];

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validBox(box: PrintBox | undefined): box is PrintBox {
  return !!box && Number.isFinite(box.left) && Number.isFinite(box.top) && positive(box.width) && positive(box.height);
}

function validItems<T extends PrintItem>(items: readonly T[] | undefined): T[] {
  return (items ?? []).filter((item) => !!item && validBox(item.box));
}

function edgeDistance(box: PrintBox, edge: PrintEdge, page: { width: number; height: number }): number {
  if (edge === "top") return box.top;
  if (edge === "right") return page.width - (box.left + box.width);
  if (edge === "bottom") return page.height - (box.top + box.height);
  return box.left;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function lowDpiIssues(images: readonly PrintImage[]): PrintIssue[] {
  const issues: PrintIssue[] = [];
  for (const image of images) {
    if (!positive(image.pixelWidth) || !positive(image.pixelHeight)) continue;
    const { box } = image;
    const dpi = Math.round(Math.min(image.pixelWidth / (box.width / MM_PER_INCH), image.pixelHeight / (box.height / MM_PER_INCH)));
    if (dpi < PRINT_MIN_DPI) issues.push({ kind: "lowDpi", block: image.block, index: image.index, dpi, box: image.box });
  }
  return issues;
}

function marginIssues(items: readonly PrintItem[], page: { width: number; height: number }): PrintIssue[] {
  const issues: PrintIssue[] = [];
  const candidates = items.filter((item) => item.box.width < page.width * BAND_SHARE && item.box.height < page.height * BAND_SHARE);
  for (const edge of EDGES) {
    let count = 0;
    let closest: PrintItem | undefined;
    let closestDistance = Infinity;
    for (const item of candidates) {
      const distance = edgeDistance(item.box, edge, page);
      if (!(distance < PRINT_SAFE_MARGIN_MM)) continue;
      count += 1;
      if (distance < closestDistance) {
        closest = item;
        closestDistance = distance;
      }
    }
    if (closest) issues.push({ kind: "margin", edge, count, distance: round(closestDistance, 1), block: closest.block, index: closest.index, box: closest.box });
  }
  return issues;
}

function underfillIssue(items: readonly PrintItem[], page: { width: number; height: number }): PrintIssue | undefined {
  const content = items.filter((item) => !(item.box.width >= page.width * BAND_SHARE && item.box.height >= page.height * BAND_SHARE));
  if (!content.length) return undefined;
  const left = Math.min(...content.map((item) => item.box.left));
  const top = Math.min(...content.map((item) => item.box.top));
  const right = Math.max(...content.map((item) => item.box.left + item.box.width));
  const bottom = Math.max(...content.map((item) => item.box.top + item.box.height));
  const box: PrintBox = { left, top, width: right - left, height: bottom - top };
  const fillH = box.height / page.height;
  const fillW = box.width / page.width;
  if (!(Math.min(fillH, fillW) < PRINT_MIN_FILL)) return undefined;
  if (fillH <= fillW) {
    const empty: PrintEdge = top > page.height - bottom ? "top" : "bottom";
    return { kind: "underfill", dimension: "height", filled: round(fillH, 2), empty, box };
  }
  const empty: PrintEdge = left > page.width - right ? "left" : "right";
  return { kind: "underfill", dimension: "width", filled: round(fillW, 2), empty, box };
}

/** Print issues of a poster: low-DPI images in input order, then margin issues by edge, then at most one underfill. */
export function checkPosterPrint(input: PrintCheckInput): PrintIssue[] {
  const page = input?.page;
  if (!page || !positive(page.width) || !positive(page.height)) return [];
  const texts = validItems(input.texts);
  const images = validItems(input.images);
  const issues = lowDpiIssues(images);
  const items: PrintItem[] = [...texts, ...images];
  issues.push(...marginIssues(items, page));
  const underfill = underfillIssue(items, page);
  if (underfill) issues.push(underfill);
  return issues;
}

/** The one-line text of a print issue, as shown in the status and the panel. */
export function describePrintIssue(issue: PrintIssue): string {
  if (issue.kind === "lowDpi") return `Image at ${issue.dpi} DPI at print size (needs ${PRINT_MIN_DPI})`;
  if (issue.kind === "margin") return `${issue.count} ${issue.count === 1 ? "item" : "items"} within ${PRINT_SAFE_MARGIN_MM} mm of the ${issue.edge} edge, closest ${issue.distance} mm`;
  return `Content fills ${Math.round(issue.filled * 100)}% of the page ${issue.dimension}; the ${issue.empty} is empty`;
}
