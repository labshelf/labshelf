// Looks up the citations of a build preview, handles their clicks and draws the citation hover card.
import { type ReaderContext, DOCUMENT_REPLACED } from "../session/index.js";
import { findDestAnchor } from "./hoverTarget.js";
import type { PageArea, CitationEntry, CitationQuery, CitationCardPaper, CitationCardFix, CitationBibEntry } from "../../index.js";
import { derivePagePoint, type PageViewportLike } from "../navigation/index.js";
import type { HoverAnchor, PopupContent } from "./hoverPreview.js";
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/index.js";
import type { PreviewRequest } from "../../protocol/previewProtocol.js";

// Opens the cited library paper when a preview's citation link is clicked; every other link keeps its own jump.

/**
 * Takes over internal link clicks in the capture phase, because the answer is asynchronous and pdf.js' handler is not.
 * A link that cites no library paper is clicked again, so pdf.js follows it as it would have.
 */
export function attachCitationClicks(viewer: HTMLElement, ctx: ReaderContext, citations: PreviewCitations): void {
  if (!ctx.boot.preview) { return; }
  let replaying = false;
  viewer.addEventListener("click", (e) => {
    const link = replaying ? null : findDestAnchor(e);
    if (!link) { return; }
    e.preventDefault();
    e.stopPropagation();
    const anchor = e.target as Element;
    // A failed lookup means no paper: the link keeps its normal jump.
    void citations.linkEntries(link).catch(() => []).then((entries) => {
      const paper = entries.find((entry) => entry.paper)?.paper;
      if (paper) { citations.open(paper.id); return; }
      replaying = true;
      try { anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } finally { replaying = false; }
    });
  }, true);
}

// Converts the places a reader points at into the page areas a preview host understands.

/** The area of a PDF annotation `rect`, which is in user space with y growing upwards, as top-left page points. */
export function deriveRectArea(page: number, rect: number[], viewBox: number[]): PageArea {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
  const [left = 0, , , top = 0] = viewBox;
  return {
    page,
    left: Math.min(x0, x1) - left,
    right: Math.max(x0, x1) - left,
    top: top - Math.max(y0, y1),
    bottom: top - Math.min(y0, y1),
  };
}

/** The area of an on-screen rectangle over a page; rotation can swap its corners, so the area is ordered afterwards. */
export function deriveScreenArea(page: number, viewport: PageViewportLike, pageEl: HTMLElement, rect: DOMRect): PageArea {
  const box = pageEl.getBoundingClientRect();
  const offsetX = box.left + pageEl.clientLeft;
  const offsetY = box.top + pageEl.clientTop;
  const a = derivePagePoint(page, viewport, rect.left - offsetX, rect.top - offsetY);
  const b = derivePagePoint(page, viewport, rect.right - offsetX, rect.bottom - offsetY);
  return { page, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
}

// Resolves what a preview reader's links and in-text citations cite, and turns it into hover cards and opens.

interface LinkAnnotationData {
  id: string;
  dest?: string | unknown[] | null;
  /** `[x0, y0, x1, y1]` in PDF user space, y growing upwards. */
  rect?: number[];
}

class LinkAnnotations {
  private readonly pages = new Map<number, Promise<LinkAnnotationData[]>>();

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.pages.clear());
  }

  async find(pageNumber: number, id: string): Promise<LinkAnnotationData | undefined> {
    return (await this.onPage(pageNumber)).find((a) => a.id === id);
  }

  private onPage(pageNumber: number): Promise<LinkAnnotationData[]> {
    let p = this.pages.get(pageNumber);
    if (!p) {
      p = this.ctx.pdfDocument.getPage(pageNumber)
        .then((page) => page.getAnnotations({ intent: "display" }))
        .then((list) => (list as Array<LinkAnnotationData & { subtype?: string }>).filter((a) => a.subtype === "Link"));
      this.pages.set(pageNumber, p);
    }
    return p;
  }
}

/** The host always answers; this only bounds the wait when the host is gone or stuck. */
export const LOOKUP_TIMEOUT_MS = 1500;

export class CitationFinder {
  private nextRequest = 1;
  private readonly waiting = new Map<number, (entries: CitationEntry[] | null) => void>();
  private readonly answers = new Map<string, Promise<CitationEntry[]>>();

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.answers.clear());
  }

  /**
   * @param cacheKey names the place for the lifetime of the open document; omit it for places that are not links.
   * @returns the entries cited at the place; empty when the host names none or does not answer in time.
   */
  lookup(query: CitationQuery, cacheKey?: string): Promise<CitationEntry[]> {
    const cached = cacheKey === undefined ? undefined : this.answers.get(cacheKey);
    if (cached) { return cached; }
    const asked = this.ask(query).then((entries) => {
      // A timeout is not an answer: the same place may be asked again.
      if (entries === null && cacheKey !== undefined) { this.answers.delete(cacheKey); }
      return entries ?? [];
    });
    if (cacheKey !== undefined) { this.answers.set(cacheKey, asked); }
    return asked;
  }

  /** Delivers the host's `citation` answer to the request that asked for it. */
  receive(request: number, entries: CitationEntry[]): void {
    const settle = this.waiting.get(request);
    this.waiting.delete(request);
    settle?.(entries);
  }

  private ask(query: CitationQuery): Promise<CitationEntry[] | null> {
    const request = this.nextRequest++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(request); resolve(null); }, LOOKUP_TIMEOUT_MS);
      this.waiting.set(request, (entries) => { clearTimeout(timer); resolve(entries); });
      this.ctx.host.post({ command: "lookupCitation", request, query });
    });
  }
}

interface PageViewLike { viewport?: PageViewportLike }

export class PreviewCitations {
  readonly lookup: CitationFinder;
  readonly annotations: LinkAnnotations;

  constructor(private readonly ctx: ReaderContext) {
    this.lookup = new CitationFinder(ctx);
    this.annotations = new LinkAnnotations(ctx);
  }

  /**
   * @returns the entries an internal link cites; always empty in a reader that is not a build preview.
   */
  async linkEntries(link: HTMLElement): Promise<CitationEntry[]> {
    const page = Number(link.closest<HTMLElement>(".page")?.dataset["pageNumber"]);
    const id = link.dataset["annotationId"];
    if (!this.ctx.boot.preview || !page || !id) { return []; }
    const annotation = await this.annotations.find(page, id);
    const viewport = this.viewport(page);
    if (!annotation?.rect || !viewport) { return []; }
    const dest = typeof annotation.dest === "string" ? annotation.dest : undefined;
    const area = deriveRectArea(page, annotation.rect, viewport.viewBox);
    return this.lookup.lookup({ area, link: true, ...(dest === undefined ? {} : { dest }) }, `${page}:${id}`);
  }

  /** The card for an internal link, or null when it cites no library paper. */
  async linkCard(link: HTMLElement): Promise<PopupContent | null> {
    return renderCitationContent(await this.linkEntries(link), (id, citedPage) => this.open(id, citedPage), (request) => this.ctx.host.post(request));
  }

  /** The card for text read as an in-text citation, or null when it cites no library paper. */
  async textCard(target: HoverAnchor, pageEl: HTMLElement, page: number): Promise<PopupContent | null> {
    const viewport = this.viewport(page);
    if (!this.ctx.boot.preview || !viewport) { return null; }
    const area = deriveScreenArea(page, viewport, pageEl, target.rect());
    return renderCitationContent(await this.lookup.lookup({ area, link: false }), (id, citedPage) => this.open(id, citedPage), (request) => this.ctx.host.post(request));
  }

  open(paperId: string, page?: number): void {
    this.ctx.host.post({ command: "openCitedPaper", paperId, ...(page === undefined ? {} : { page }) });
  }

  private viewport(page: number): PageViewportLike | undefined {
    return (this.ctx.pdfViewer.getPageView(page - 1) as PageViewLike | undefined)?.viewport;
  }
}

// Builds the hover card that shows the library papers behind a citation.

function singleBody(entry: CitationEntry, open: (paperId: string, page?: number) => void, post: PostRequest): HTMLElement {
  const { paper } = entry;
  return renderElement("div", { class: "rd-hover-cite rd-cite-flat" },
    renderCitationHead(entry),
    paper?.highlights?.length ? renderFlatHighlights(paper.highlights, entry.citedPage) : null,
    ...renderCitationActions(entry, open, post));
}

function row(entry: CitationEntry, open: (paperId: string, page?: number) => void): HTMLElement {
  const { paper } = entry;
  if (!paper) {
    return renderElement("div", { class: "rd-cite-row" }, renderElement("code", { class: "rd-cite-key" }, entry.key), renderElement("span", { class: "rd-cite-missing" }, "Not in your library"));
  }
  const button = renderElement("button", { class: "rd-cite-row rd-cite-row-paper", type: "button", "aria-label": `${OPEN_PAPER_LABEL}: ${paper.title}` },
    renderElement("span", { class: "rd-cite-title" }, paper.title),
    formatByline(paper) && renderElement("span", { class: "rd-cite-byline" }, formatByline(paper)),
    renderElement("code", { class: "rd-cite-key" }, entry.key),
  );
  button.addEventListener("click", () => open(paper.id));
  return button;
}

/**
 * @returns the card for the entries, or null when none of them is a card subject; `post` lets the card go to a source line and
 * run its fix.
 */
export function renderCitationContent(entries: CitationEntry[], open: (paperId: string, page?: number) => void, post: PostRequest): PopupContent | null {
  const first = entries.find((entry) => entry.paper);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only && (only.paper || only.bib || only.fix)) {
    const { paper, site } = only;
    const jump = paper ? () => openAt(open, paper.id, only.citedPage)
      : () => { if (site) { post({ command: "openSourceLine", file: site.file, line: site.line }); } };
    return { title: paper ? "Cited paper" : "Cited key", body: singleBody(only, open, post), copyText: only.key, jump, jumpLabel: paper ? openLabel(only) : "Go to source", bare: true };
  }
  if (!first?.paper) { return null; }
  const paperId = first.paper.id;
  return {
    title: "Cited papers",
    body: renderElement("div", { class: "rd-hover-cites" }, ...entries.map((entry) => row(entry, open))),
    copyText: entries.map((entry) => entry.key).join(", "),
    jump: () => open(paperId),
    jumpLabel: OPEN_PAPER_LABEL,
  };
}

// Renders a paper's highlights for a citation card: those on the cited page first, the rest folded.

type Highlight = NonNullable<CitationCardPaper["highlights"]>[number];

/** The colour is the only thing a highlight says about itself, so it shows as a swatch with no label. */
function item(highlight: Highlight): HTMLElement {
  return renderElement("li", { class: `rd-cite-highlight${highlight.color ? ` rd-cite-hl-${highlight.color}` : ""}` },
    renderElement("span", { class: "rd-cite-quote", text: highlight.text }),
    renderElement("span", { class: "rd-cite-page", text: `p. ${highlight.page}` }));
}

const list = (highlights: Highlight[]): HTMLElement => renderElement("ul", { class: "rd-cite-list" }, ...highlights.map(item));

/** @returns the highlights in one list, or, when a page is cited, that page's highlights above a folded group of the others. */
function renderHighlightsPanel(highlights: Highlight[], citedPage: number | undefined): HTMLElement {
  if (citedPage === undefined) { return renderElement("div", { class: "rd-cite-highlights" }, list(highlights)); }
  const onPage = highlights.filter((h) => h.page === citedPage);
  const others = highlights.filter((h) => h.page !== citedPage);
  return renderElement("div", { class: "rd-cite-highlights" },
    onPage.length ? list(onPage) : renderElement("p", { class: "rd-cite-empty", text: "None on this page" }),
    others.length > 0 && renderElement("details", {}, renderElement("summary", {}, renderElement("span", { class: "rd-cite-chevron", html: renderIcon("chevron-right") }), `Other highlights (${others.length})`), list(others)));
}

/** The preview card's highlights: a label naming the cited page above the highlights panel. */
export function renderFlatHighlights(highlights: Highlight[], citedPage: number | undefined): HTMLElement {
  return renderElement("div", { class: "rd-cite-flat-highlights" },
    renderElement("p", { class: "rd-cite-label", text: citedPage === undefined ? "Your highlights" : `Your highlights on p. ${citedPage}` }),
    renderHighlightsPanel(highlights, citedPage));
}

// Builds a citation card's actions (open the paper, go to the citing source line) and its one fix row.

export const OPEN_PAPER_LABEL = "Open paper";

export type PostRequest = (request: PreviewRequest) => void;

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = renderElement("button", { class: primary ? "rd-cite-btn rd-cite-btn-primary" : "rd-cite-btn", type: "button", text: label });
  node.addEventListener("click", onClick);
  return node;
}

/** @returns the label of the action that opens the cited paper, at the cited page when there is one. */
export function openLabel(entry: CitationEntry): string {
  return entry.citedPage === undefined ? OPEN_PAPER_LABEL : `Open at p. ${entry.citedPage}`;
}

/** Opens a cited paper, at `page` when the citation names one. */
export function openAt(open: (paperId: string, page?: number) => void, paperId: string, page: number | undefined): void {
  if (page === undefined) { open(paperId); } else { open(paperId, page); }
}

/** @returns the fix button for the entry, or null when the fix cannot run (a replacement needs the citing command). */
function fixButton(entry: CitationEntry, fix: CitationCardFix, post: PostRequest): HTMLButtonElement | null {
  const { key, site } = entry;
  switch (fix.kind) {
    case "replace":
      return site ? button(`Replace with ${fix.suggestion}`, () => post({ command: "fixCitation", fix: { kind: "replace", key, replacement: fix.suggestion, file: site.file, line: site.line } }), true) : null;
    case "update":
      return button(`Update to ${fix.venue}`, () => post({ command: "fixCitation", fix: { kind: "update", key } }), true);
    case "add":
      return button("Add to library", () => post({ command: "fixCitation", fix: { kind: "add", key } }), true);
  }
}

/** @returns the action row and the fix row for a card of a build preview; each is null when it has nothing to offer. */
export function renderCitationActions(entry: CitationEntry, open: (paperId: string, page?: number) => void, post: PostRequest): HTMLElement[] {
  const { paper, site, fix } = entry;
  const actions = [
    paper && button(openLabel(entry), () => openAt(open, paper.id, entry.citedPage)),
    site && button("Go to source", () => post({ command: "openSourceLine", file: site.file, line: site.line })),
  ].filter((node) => node !== undefined && node !== null);
  const fixNode = fix && fixButton(entry, fix, post);
  return [
    actions.length > 0 ? renderElement("div", { class: "rd-cite-acts" }, ...actions) : null,
    fixNode ? renderElement("div", { class: "rd-cite-fix" }, fixNode) : null,
  ].filter((node) => node !== null);
}

// Builds the head of a single-entry citation card: tag, byline, title, venue and the citing command.

/** Authors and year on one line; either may be missing. */
export function formatByline(record: Pick<CitationBibEntry, "authors" | "year">): string {
  return [record.authors.join(", "), record.year === undefined ? "" : String(record.year)].filter(Boolean).join(" · ");
}

/** The first author's surname and "et al." for several authors; either part may be missing. */
function shortByline(record: Pick<CitationBibEntry, "authors" | "year">): string {
  const [first] = record.authors;
  const lead = record.authors.length > 1 && first ? `${first.trim().split(/\s+/).pop()} et al.` : record.authors.join(", ");
  return [lead, record.year === undefined ? "" : String(record.year)].filter(Boolean).join(" · ");
}

function venueLine(entry: CitationEntry): string {
  const folder = entry.paper?.folder?.split("/").join(" › ");
  return [entry.paper?.venue ?? entry.bib?.venue, folder].filter(Boolean).join(" · ");
}

/** The tag says where the key was found: REF for a library paper, BIB for a record only in the `.bib` file. */
function tag(entry: CitationEntry): HTMLElement | null {
  if (entry.paper) { return renderElement("span", { class: "rd-cite-tag", text: "REF" }); }
  return entry.bib ? renderElement("span", { class: "rd-cite-tag", text: "BIB" }) : null;
}

export function renderCitationHead(entry: CitationEntry): HTMLElement {
  const record: CitationCardPaper | CitationBibEntry | undefined = entry.paper ?? entry.bib;
  const title = record?.title ?? entry.key;
  const { site } = entry;
  const venue = venueLine(entry);
  const names = record && shortByline(record);
  return renderElement("div", { class: "rd-cite-head" },
    renderElement("div", { class: "rd-cite-head-text" },
      renderElement("div", { class: "rd-cite-top" },
        names && renderElement("p", { class: "rd-cite-byline" }, names),
        tag(entry),
      ),
      renderElement("p", { class: "rd-cite-title" }, title),
      venue && renderElement("p", { class: "rd-cite-venue" }, venue),
      site && renderElement("p", { class: "rd-cite-site" }, `${site.file}:${site.line} · ${site.text}`),
    ),
  );
}
