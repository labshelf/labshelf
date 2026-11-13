// The build preview's rail: a thin bar beside the pages that maps the document (headings, with included files expanded, and marks for
// comments, suggested edits, equations, figures, tables and images), shows where the view is, and links the PDF and the source both ways.
import type { PagePoint, WebviewToHost } from "../protocol/index.js";
import {
  deriveDocumentMapOrder, findDocumentMapLine, interpolateDocumentMap, invertDocumentMap, matchDocumentMapOutline,
  type DocumentMap, type DocumentMapMark, type DocumentMapPlace,
} from "../../writing/documentMap/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import { deriveOutlineRows, type OutlineRow, type RawOutlineNode } from "../outline.js";
import type { ReaderContext } from "./readerSession.js";
import { DOCUMENT_REPLACED } from "./pdfLoader.js";
import { derivePagePoint, derivePixelOffset, type PageViewportLike } from "./navigation.js";

// Where a reached place lands and where "here" is read, as a fraction of the view's height from its top; the same as SourceSync.
const VIEW_LINE = 1 / 3;
const COLLAPSED_KEY = "labshelf.preview.documentMap.collapsed";
// Marks of one kind closer than this (fraction of the rail) show as one.
const MARK_BUCKET = 0.004;
// Heading depths the rail draws: numbered tick, short tick, dot. Deeper headings are left to the editor's outline.
const SHOWN_DEPTHS = 3;
const RELAYOUT_EVENTS = ["pagesloaded", "scalechanging", "rotationchanging", "spreadmodechanged", "scrollmodechanged"];

const MARK_NAMES: Record<DocumentMapMark["kind"], string> = {
  comment: "Comment", edit: "Suggested edit", equation: "Equation", figure: "Figure", table: "Table", image: "Image",
};

interface SyncPageView {
  div: HTMLElement;
  viewport?: PageViewportLike;
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

function storeCollapsed(collapsed: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* storage is optional: the rail opens expanded next time */ }
}

function railButton(className: string, label: string, glyph: IconName, onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: `rd-docmap-button ${className}`, type: "button", title: label, "aria-label": label, html: renderIcon(glyph) });
  button.addEventListener("click", onClick);
  return button;
}

/** The page point of an outline destination: XYZ carries [left, top, zoom], FitH and FitBH carry [top]; other kinds point at the page's top. */
async function readOutlinePoint(ctx: ReaderContext, dest: OutlineRow["dest"]): Promise<PagePoint | undefined> {
  const doc = ctx.pdfDocument;
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) { return undefined; }
    const ref: unknown = explicit[0];
    const index = typeof ref === "number" ? ref : ref && typeof ref === "object" ? await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]) : undefined;
    if (index === undefined) { return undefined; }
    const viewTop = (ctx.pdfViewer.getPageView(index) as SyncPageView | undefined)?.viewport?.viewBox[3] ?? 0;
    const kind = (explicit[1] as { name?: string } | undefined)?.name;
    const top = kind === "XYZ" ? explicit[3] : kind === "FitH" || kind === "FitBH" ? explicit[2] : undefined;
    return { page: index + 1, x: 0, y: typeof top === "number" ? Math.max(0, viewTop - top) : 0 };
  } catch {
    return undefined;
  }
}

/** The rail at the pages' edge in the preview shell; hidden until the host sends a map. */
export class DocumentMapRail {
  private map: DocumentMap | undefined;
  private linked = false;
  private collapsed = readCollapsed();
  // Heading index to its outline point, for a build without SyncTeX; read again for every document.
  private outlinePoints = new Map<number, PagePoint>();
  private outlineFor: unknown;
  private anchors: { at: number; y: number }[] = [];
  private headingY: number[] = [];
  private currentHeading = -1;
  private frame = 0;
  private readonly container: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly rail = renderElement("nav", { class: "rd-docmap", "aria-label": "Document map", hidden: "" });
  private readonly toggle = railButton("rd-docmap-toggle", "", "chevron-left", () => this.setCollapsed(!this.collapsed));
  private readonly track = renderElement("div", { class: "rd-docmap-track" });
  private readonly view = renderElement("div", { class: "rd-docmap-view" });
  private readonly here = renderElement("div", { class: "rd-docmap-here" });
  private readonly items = renderElement("div", { class: "rd-docmap-items" });
  private readonly tip = renderElement("div", { class: "rd-docmap-tip", role: "tooltip", hidden: "" });

  constructor(private readonly ctx: ReaderContext, private readonly post: (message: WebviewToHost) => void) {
    this.container = ctx.container;
    this.shell = ctx.container.parentElement ?? ctx.container;
    const toSource = railButton("rd-docmap-sync", "Show this place in the source", "arrow-left", () => this.syncToSource());
    const toPdf = railButton("rd-docmap-sync", "Show the editor cursor in the PDF", "arrow-right", () => post({ command: "revealCursor" }));
    this.track.append(renderElement("div", { class: "rd-docmap-line" }), this.view, this.items, this.here);
    this.rail.append(renderElement("div", { class: "rd-docmap-head" }, this.toggle, toSource, toPdf), this.track, this.tip);
    this.shell.append(this.rail);
    this.setCollapsed(this.collapsed);
    this.listen();
  }

  private listen(): void {
    const { ctx, container } = this;
    const resize = new ResizeObserver(() => { this.place(); this.layout(); });
    resize.observe(container);
    resize.observe(this.shell);
    container.addEventListener("scroll", () => {
      if (this.frame) { return; }
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.follow(); });
    }, { passive: true });
    for (const event of RELAYOUT_EVENTS) { ctx.eventBus.on(event, () => requestAnimationFrame(() => this.layout())); }
    ctx.eventBus.on(DOCUMENT_REPLACED, () => { void this.readOutline(); requestAnimationFrame(() => this.layout()); });
    ctx.host.on("documentMap", (msg) => this.show(msg.map));
    ctx.host.on("revealSourceLine", (msg) => this.revealSourceLine(msg.file, msg.line));
    // A root with SyncTeX data lets the arrows ask the host for exact positions.
    ctx.host.on("previewRoots", ({ roots }) => { this.linked = roots.roots.find((root) => root.path === roots.shown)?.sourceLinks ?? false; });
  }

  show(map: DocumentMap): void {
    const first = !this.map;
    this.map = map;
    this.outlineFor = undefined;
    this.rail.hidden = false;
    this.shell.classList.add("rd-docmap-on");
    if (first) { this.place(); }
    this.layout();
    void this.readOutline();
  }

  /** Scrolls to where the rail places a source line. */
  revealSourceLine(file: string, line: number): void {
    const at = this.map && deriveDocumentMapOrder(this.map.segments, file, line);
    if (at === undefined || !this.map) { return; }
    this.scrollToY(interpolateDocumentMap(this.anchors, at, this.map.body, this.container.scrollHeight));
  }

  // --- Layout: the rail covers the pages' row of the shell; the pages give way to it ---

  private place(): void {
    this.rail.style.top = `${this.container.offsetTop}px`;
    this.rail.style.height = `${this.container.offsetHeight}px`;
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    storeCollapsed(collapsed);
    this.rail.toggleAttribute("data-collapsed", collapsed);
    const label = collapsed ? "Show the document map" : "Hide the document map";
    this.toggle.title = label;
    this.toggle.setAttribute("aria-label", label);
    this.toggle.innerHTML = renderIcon(collapsed ? "chevron-right" : "chevron-left");
    this.tip.hidden = true;
  }

  private scrollToY(y: number): void {
    this.container.scrollTop = Math.max(0, y - this.container.clientHeight * VIEW_LINE);
  }

  // --- Positions: a place's height in the scrolled pages, from its point, else between the headings that have one ---

  private pointY(point: PagePoint): number | undefined {
    const page = this.ctx.pdfViewer.getPageView(point.page - 1) as SyncPageView | undefined;
    if (!page?.viewport || point.page > this.ctx.pdfDocument.numPages) { return undefined; }
    const [, pixelY] = derivePixelOffset(page.viewport, point);
    const box = this.container.getBoundingClientRect();
    return this.container.scrollTop + page.div.getBoundingClientRect().top - box.top + page.div.clientTop + pixelY;
  }

  private yOf(entry: DocumentMapPlace): number {
    const exact = entry.point && this.pointY(entry.point);
    return exact ?? interpolateDocumentMap(this.anchors, entry.at, this.map!.body, this.container.scrollHeight);
  }

  /** The headings with a known height, kept only while heights grow with source order. */
  private readAnchors(): void {
    this.anchors = [];
    let last = -Infinity;
    this.map?.headings.forEach((heading, index) => {
      const point = heading.point ?? this.outlinePoints.get(index);
      const y = point && this.pointY(point);
      if (y === undefined || y < last) { return; }
      this.anchors.push({ at: heading.at, y });
      last = y;
    });
  }

  /** Places the headings SyncTeX did not through the PDF's outline, matched by title. */
  private async readOutline(): Promise<void> {
    const { map, ctx } = this;
    const doc = ctx.pdfDocument;
    if (!map || this.outlineFor === doc) { return; }
    this.outlineFor = doc;
    this.outlinePoints = new Map();
    if (map.headings.every((heading) => heading.point)) { return; }
    let raw: RawOutlineNode[] | null = null;
    try { raw = (await doc.getOutline()) as RawOutlineNode[] | null; } catch { return; }
    const rows = deriveOutlineRows(raw);
    const found = new Map<number, PagePoint>();
    for (const [heading, row] of matchDocumentMapOutline(map.headings, rows)) {
      const point = await readOutlinePoint(ctx, rows[row]!.dest);
      if (doc !== ctx.pdfDocument || map !== this.map) { return; }
      if (point) { found.set(heading, point); }
    }
    this.outlinePoints = found;
    this.layout();
  }

  // --- Drawing ---

  private withTip(target: HTMLElement, text: string): HTMLElement {
    target.addEventListener("pointerenter", () => {
      this.tip.textContent = text;
      this.tip.hidden = false;
      this.tip.style.top = `${target.offsetTop + this.track.offsetTop}px`;
    });
    target.addEventListener("pointerleave", () => { this.tip.hidden = true; });
    return target;
  }

  /** Scrolls the PDF to the place and opens its source line. */
  private go(entry: DocumentMapPlace): void {
    this.scrollToY(this.yOf(entry));
    this.post({ command: "openSourceLine", file: entry.file, line: entry.line });
  }

  private layout(): void {
    if (!this.map) { return; }
    this.readAnchors();
    const height = Math.max(1, this.container.scrollHeight);
    this.headingY = this.map.headings.map((heading) => this.yOf(heading));
    this.items.replaceChildren(...this.headingNodes(height), ...this.markNodes(height));
    this.currentHeading = -1;
    this.follow();
  }

  private headingNodes(height: number): HTMLElement[] {
    const headings = this.map?.headings ?? [];
    const levels = [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b);
    const nodes: HTMLElement[] = [];
    let number = 0;
    headings.forEach((heading, index) => {
      const depth = levels.indexOf(heading.level);
      if (depth >= SHOWN_DEPTHS) { return; }
      if (depth === 0) { number++; }
      const node = renderElement("button", {
        class: "rd-docmap-heading", type: "button", "data-depth": String(depth), "data-index": String(index),
        "aria-label": heading.title, style: `top:${((this.headingY[index]! / height) * 100).toFixed(3)}%`,
      }, depth === 0 ? renderElement("span", { class: "rd-docmap-number" }, String(number)) : null);
      node.addEventListener("click", () => this.go(heading));
      nodes.push(this.withTip(node, `${heading.title} · ${heading.file}:${heading.line}`));
    });
    return nodes;
  }

  private markNodes(height: number): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const seen = new Set<string>();
    for (const mark of this.map?.marks ?? []) {
      const top = this.yOf(mark) / height;
      const bucket = `${mark.kind}:${Math.round(top / MARK_BUCKET)}`;
      if (seen.has(bucket)) { continue; }
      seen.add(bucket);
      const name = MARK_NAMES[mark.kind];
      const node = renderElement("button", { class: "rd-docmap-mark", type: "button", "data-kind": mark.kind, "aria-label": name, style: `top:${(top * 100).toFixed(3)}%` });
      node.addEventListener("click", () => this.go(mark));
      nodes.push(this.withTip(node, mark.label ? `${name} · ${mark.label}` : name));
    }
    return nodes;
  }

  /** Moves the view band and the "here" dot with the scroll, and marks the heading the view is in. */
  private follow(): void {
    const { container } = this;
    if (!this.map) { return; }
    const height = Math.max(1, container.scrollHeight);
    this.view.style.top = `${(container.scrollTop / height) * 100}%`;
    this.view.style.height = `${(container.clientHeight / height) * 100}%`;
    const y = container.scrollTop + container.clientHeight * VIEW_LINE;
    this.here.style.top = `${(y / height) * 100}%`;
    let current = -1;
    this.headingY.forEach((top, index) => { if (top <= y + 1) { current = index; } });
    if (current === this.currentHeading) { return; }
    this.currentHeading = current;
    for (const node of this.items.querySelectorAll<HTMLElement>(".rd-docmap-heading")) {
      node.toggleAttribute("data-current", Number(node.dataset["index"]) === current);
    }
  }

  // --- Linking the PDF and the source ---

  /** The page point at the view line, a quarter in from the page's left (in the text of one- and two-column layouts); undefined between pages. */
  private viewPoint(): PagePoint | undefined {
    const { ctx, container } = this;
    const y = container.getBoundingClientRect().top + container.clientHeight * VIEW_LINE;
    for (let index = 0; index < ctx.pdfDocument.numPages; index++) {
      const page = ctx.pdfViewer.getPageView(index) as SyncPageView | undefined;
      const rect = page?.div.getBoundingClientRect();
      if (!page?.viewport || !rect || y < rect.top || y > rect.bottom) { continue; }
      return derivePagePoint(index + 1, page.viewport, rect.width / 4, y - rect.top - page.div.clientTop);
    }
    return undefined;
  }

  /** Opens the source behind the view: exactly through the host's SyncTeX data, else the line the rail places there. */
  private syncToSource(): void {
    const point = this.linked ? this.viewPoint() : undefined;
    if (point) { this.post({ command: "showSource", point }); return; }
    if (!this.map) { return; }
    const { container } = this;
    const at = invertDocumentMap(this.anchors, container.scrollTop + container.clientHeight * VIEW_LINE, this.map.body, container.scrollHeight);
    const found = findDocumentMapLine(this.map.segments, Math.round(at));
    if (found) { this.post({ command: "openSourceLine", file: found.file, line: found.line }); }
  }
}
