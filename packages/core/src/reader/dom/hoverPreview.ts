// Shows the hover preview of in-text references and links: the preview itself, its popup and where it anchors.
import type { CitationResolver, FloatResolver } from "./textLayer.js";
import type { ReaderContext } from "./readerSession.js";
import type { PreviewCitations } from "./citations.js";
import {
  type DestPreview, findDestAnchor, DestContent, createDestHoverAnchor, renderTextContent, runUnderPointer, TextAnchors,
} from "./hoverTarget.js";
import { findElement, renderElement } from "../../ui/dom/index.js";
import type { FloatKind, InTextReference } from "../inTextReferences.js";
import { deriveClampedNumber, renderReaderIconButton } from "./elements.js";
import { renderIcon } from "../../ui/index.js";

// Opens one hover popup for a PDF link annotation or a text reference under the pointer.
// Owns the timers, targets and the `attempt` token that drops stale async work.

const MAX_MARKER_ENTRIES = 3;
const FLOAT_TITLES: Record<FloatKind, string> = { figure: "Figure", table: "Table", equation: "Equation" };
// Hovering a caption's own label ("Figure 3.") should not pop up a picture of itself.
const SAME_PLACE_POINTS = 16;

class ReferenceContent {
  constructor(
    private readonly ctx: ReaderContext,
    private readonly resolver: CitationResolver,
    private readonly floats: FloatResolver,
    private readonly preview: DestPreview,
    private readonly citations: PreviewCitations,
  ) {}

  async prepareText(target: HoverAnchor, isCurrent: () => boolean): Promise<PopupContent | null> {
    const ref = target.ref;
    const pageEl = target.group[0]?.closest<HTMLElement>(".page");
    const pageNumber = Number(pageEl?.dataset["pageNumber"]);
    if (!ref || !pageEl || !pageNumber) { return null; }
    if (ref.kind === "float") { return this.prepareFloat(target, ref, pageEl, pageNumber, isCurrent); }
    return (await this.citations.textCard(target, pageEl, pageNumber)) ?? this.prepareCitation(ref);
  }

  private async prepareCitation(ref: Exclude<InTextReference, { kind: "float" }>): Promise<PopupContent | null> {
    const hits: Array<{ text: string; pageNumber: number; y: number }> = [];
    let missing = 0;
    if (ref.kind === "numeric") {
      for (const n of ref.numbers.slice(0, MAX_MARKER_ENTRIES)) {
        const hit = await this.resolver.entryNumbered(n);
        if (hit) { hits.push(hit); }
      }
      missing = ref.numbers.length - hits.length;
    } else {
      hits.push(...await this.resolver.entriesByAuthorYear(ref));
    }
    const first = hits[0];
    if (!first) { return null; }
    const texts = hits.map((hit) => hit.text);
    if (ref.kind === "numeric" && missing > 0 && ref.numbers.length > MAX_MARKER_ENTRIES) { texts.push(`+${missing} more`); }
    return renderTextContent(texts, () => this.jumpTo(first.pageNumber, null, first.y));
  }

  private async prepareFloat(
    target: HoverAnchor,
    ref: Extract<InTextReference, { kind: "float" }>,
    pageEl: HTMLElement,
    pageNumber: number,
    isCurrent: () => boolean,
  ): Promise<PopupContent | null> {
    const found = await this.floats.find(ref.floatKind, ref.label);
    if (!found || !isCurrent()) { return null; }
    if (found.pageNumber === pageNumber) {
      const view = this.ctx.pdfViewer.getPageView(pageNumber - 1) as { viewport?: { convertToPdfPoint(x: number, y: number): number[] } } | undefined;
      const at = target.rect();
      const pdfY = view?.viewport?.convertToPdfPoint(0, at.top + at.height / 2 - pageEl.getBoundingClientRect().top - pageEl.clientTop)[1];
      if (pdfY !== undefined && Math.abs(pdfY - found.captionY) < SAME_PLACE_POINTS) { return null; }
    }
    const canvas = await this.preview.renderRegion(found.pageNumber, found.region);
    if (!canvas) { return null; }
    return {
      title: `${FLOAT_TITLES[ref.floatKind]} ${ref.label.toUpperCase()} · Page ${found.pageNumber}`,
      body: canvas,
      copyText: null,
      jump: () => this.jumpTo(found.pageNumber, found.region.x0, found.region.yTop),
    };
  }

  /** Goes through the link service so the jump lands in the back/forward history like a followed link. */
  private jumpTo(pageNumber: number, x: number | null, y: number | null): void {
    const dest = [pageNumber - 1, { name: "XYZ" }, x, y, null] as unknown as PdfDestination;
    void this.ctx.linkService.goToDestination(dest);
  }
}

const CLOSE_GRACE_MS = 150;

export class HoverPreview {
  private readonly popup = new HoverPopup();
  private links: DestContent;
  private references: ReferenceContent;
  private readonly texts = new TextAnchors();
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Target of the visible popup, and the one whose delay is running. */
  private open: HoverAnchor | null = null;
  private pending: HoverAnchor | null = null;
  /** Identifies the current pending/visible popup; async work belonging to an older one is dropped. */
  private attempt = 0;
  private lastMove: { run: HTMLElement; x: number; y: number } | null = null;
  private moveFrame = 0;

  constructor(
    private readonly ctx: ReaderContext,
    resolver: CitationResolver,
    floats: FloatResolver,
    private readonly preview: DestPreview,
    private readonly citations: PreviewCitations,
  ) {
    this.links = new DestContent(ctx, resolver, preview, citations);
    this.references = new ReferenceContent(ctx, resolver, floats, preview, citations);
    const viewer = findElement("viewer");
    viewer.addEventListener("mouseover", (e) => this.onOver(e));
    viewer.addEventListener("mouseout", (e) => this.onOut(e));
    viewer.addEventListener("mousemove", (e) => this.onTextMove(e), { passive: true });
    this.popup.onEnter(() => this.cancelClose());
    this.popup.onLeave(() => this.scheduleClose());
    ctx.container.addEventListener("scroll", () => this.close(), { passive: true });
    ctx.eventBus.on("scalechanging", () => this.close());
    document.addEventListener("keydown", () => this.close());
    document.addEventListener("mousedown", (e) => { if (!this.popup.contains(e.target as Node)) { this.close(); } });
  }

  /**
   * Answers from another document's text, e.g. after a reload; any open popup belonged to the old one.
   */
  useText(resolver: CitationResolver, floats: FloatResolver): void {
    this.close();
    this.links = new DestContent(this.ctx, resolver, this.preview, this.citations);
    this.references = new ReferenceContent(this.ctx, resolver, floats, this.preview, this.citations);
  }

  /**
   * Cancels any pending open, hides the popup and discards in-flight preview work.
   */
  close(): void {
    this.cancelPending();
    this.cancelClose();
    this.preview.cancel();
    this.hide();
  }

  private get enabled(): boolean { return this.ctx.prefs.hoverPreviews; }

  private hide(): void {
    this.open = null;
    this.popup.hide();
  }

  private cancelPending(): void {
    this.attempt++;
    if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null; }
    this.pending = null;
  }

  /**
   * Opens a popup for `target` once the reader has rested on it for the configured delay. The content is prepared
   * while the delay runs, so reference lookup and page rendering do not add to it.
   */
  private schedule(target: HoverAnchor, prepare: (isCurrent: () => boolean) => Promise<PopupContent | null>): void {
    this.cancelPending();
    const attempt = this.attempt;
    const isCurrent = (): boolean => attempt === this.attempt;
    this.pending = target;
    const rested = new Promise<void>((resolve) => {
      this.openTimer = setTimeout(resolve, Math.max(0, this.ctx.prefs.hoverDelayMs));
    });
    // A broken destination or a failed extraction simply has no preview; the page itself is untouched.
    const content = prepare(isCurrent).catch(() => null);
    void Promise.all([rested, content]).then(([, ready]) => {
      if (!isCurrent()) { return; }
      this.openTimer = null;
      this.pending = null;
      if (ready) { this.show(target, ready); }
    });
  }

  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => { this.closeTimer = null; this.hide(); }, CLOSE_GRACE_MS);
  }

  private cancelClose(): void {
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
  }

  /** Leaving a target cancels its pending popup, or starts closing its open one; moving into the popup keeps it. */
  private onOut(e: MouseEvent): void {
    const from = e.target as Node;
    const to = e.relatedTarget as Node | null;
    const left = (target: HoverAnchor | null): boolean =>
      target !== null && target.group.some((g) => g.contains(from))
      && !(to !== null && (this.popup.contains(to) || target.group.some((g) => g.contains(to))));
    if (left(this.pending)) { this.cancelPending(); }
    if (left(this.open)) { this.scheduleClose(); }
  }

  private onOver(e: MouseEvent): void {
    if (!this.enabled) { return; }
    const link = findDestAnchor(e);
    if (!link) { return; }
    const target = createDestHoverAnchor(link);
    if (isSameHoverAnchor(target, this.open)) { this.cancelClose(); return; }
    if (isSameHoverAnchor(target, this.pending)) { return; }
    this.schedule(target, (isCurrent) => this.links.prepare(link, isCurrent));
  }

  private onTextMove(e: MouseEvent): void {
    // A pressed button means the reader is selecting text, not pointing at it.
    if (!this.enabled || e.buttons !== 0) { return; }
    const run = runUnderPointer(e);
    if (!run) { return; }
    this.lastMove = { run, x: e.clientX, y: e.clientY };
    // One probe per frame, however many move events the frame carried.
    if (this.moveFrame) { return; }
    this.moveFrame = requestAnimationFrame(() => { this.moveFrame = 0; this.probeText(); });
  }

  /**
   * Decides what the pointer is on. The delay belongs to the REFERENCE, not to the pointer position: a hand never
   * holds still, and restarting the timer on every tremor made the popup wait for a stillness that does not come.
   */
  private probeText(): void {
    const move = this.lastMove;
    if (!move || !move.run.isConnected) { return; }
    const target = this.texts.targetAt(move.run, move.x, move.y);
    if (target && isSameHoverAnchor(target, this.open)) { this.cancelClose(); return; }
    // Inside a long run the pointer can leave a reference without leaving the element, so no mouseout says so.
    if (this.open?.ref && this.open.group.includes(move.run) && !this.closeTimer) { this.scheduleClose(); }
    if (!target) {
      if (this.pending?.ref) { this.cancelPending(); }
      return;
    }
    if (isSameHoverAnchor(target, this.pending)) { return; }
    this.schedule(target, (isCurrent) => this.references.prepareText(target, isCurrent));
  }

  private show(target: HoverAnchor, content: PopupContent): void {
    this.cancelClose();
    this.open = target;
    this.popup.show(
      content,
      target.rect(),
      (text) => { this.ctx.host.post({ command: "copyText", text }); this.close(); },
      () => { this.close(); content.jump(); },
    );
  }
}

/** Drives the #hover-popup element: fills it with a title, actions and body, places it next to its anchor and hides it. */

class HoverPopup {
  private readonly el = findElement("hover-popup");

  onEnter(handler: () => void): void { this.el.addEventListener("mouseenter", handler); }

  onLeave(handler: () => void): void { this.el.addEventListener("mouseleave", handler); }

  contains(node: Node): boolean { return this.el.contains(node); }

  hide(): void {
    this.el.classList.remove("rd-visible");
    this.el.replaceChildren();
  }

  show(content: PopupContent, anchor: DOMRect, onCopy: (text: string) => void, onJump: () => void): void {
    const actions = renderElement("div", { class: "rd-hover-actions" });
    const { copyText } = content;
    if (copyText) {
      const copy = renderReaderIconButton(renderIcon("copy"), "Copy reference", "rd-btn-sm");
      copy.addEventListener("click", () => onCopy(copyText));
      actions.append(copy);
    }
    const go = renderReaderIconButton(renderIcon("arrow-right"), content.jumpLabel ?? "Jump to destination", "rd-btn-sm");
    go.addEventListener("click", onJump);
    actions.append(go);

    this.el.replaceChildren(...(content.bare ? [content.body] : [renderElement("div", { class: "rd-hover-header" }, renderElement("span", {}, content.title), actions), content.body]));
    this.el.classList.add("rd-visible");
    const p = this.el.getBoundingClientRect();
    const below = anchor.bottom + 8;
    const top = below + p.height <= window.innerHeight - 8 ? below : anchor.top - p.height - 8;
    this.el.style.top = `${deriveClampedNumber(top, 8, Math.max(8, window.innerHeight - p.height - 8))}px`;
    this.el.style.left = `${deriveClampedNumber(anchor.left + anchor.width / 2 - p.width / 2, 8, Math.max(8, window.innerWidth - p.width - 8))}px`;
  }
}

/** Declares what a pending or visible hover popup belongs to, and what it shows. */

export type PdfDestination = Parameters<ReaderContext["linkService"]["goToDestination"]>[0];

export interface HoverAnchor {
  /** Every element of the target: a link, or the text runs of a reference — OCR text is one run per word, and crossing words must neither restart nor close the popup. */
  group: Element[];
  /** The reference inside those runs; tells two references in one long run apart. Null for a link annotation. */
  ref: InTextReference | null;
  /** Where the reference sits on screen, for placing the popup. */
  rect(): DOMRect;
}

export interface PopupContent {
  title: string;
  body: HTMLElement;
  copyText: string | null;
  jump: () => void;
  /** Names what the jump button does; defaults to going to the destination. */
  jumpLabel?: string;
  /** The card brings its own actions, so the popup shows no title bar. */
  bare?: boolean;
}

function isSameHoverAnchor(a: HoverAnchor | null, b: HoverAnchor | null): boolean {
  return a !== null && b !== null && a.group[0] === b.group[0] && a.ref?.start === b.ref?.start && a.ref?.end === b.ref?.end;
}
