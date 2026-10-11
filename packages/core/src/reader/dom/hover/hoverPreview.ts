/**
 * Hover previews. Two ways in, one popup out: a PDF link annotation under the pointer, or a reference found in the
 * plain text under it (scans with an OCR layer, papers typeset without hyperlinks). This controller owns the timers,
 * the pending and open targets and the `attempt` token that drops stale async work; the content comes from
 * `LinkContent` and `ReferenceContent`, the drawing from `HoverPopup`.
 */
import type { CitationResolver, FloatResolver } from "../text/index.js";
import { byId } from "../elements/index.js";
import type { ReaderContext } from "../session/index.js";
import type { DestPreview } from "./destPreview.js";
import { sameTarget, type HoverTarget, type PopupContent } from "./hoverTarget.js";
import { findLink, LinkContent, linkHoverTarget } from "./linkTarget.js";
import { HoverPopup } from "./popup.js";
import { ReferenceContent } from "./referenceContent.js";
import { runUnderPointer, TextTargets } from "./textTarget.js";

const CLOSE_GRACE_MS = 150;

export class HoverPreview {
  private readonly popup = new HoverPopup();
  private readonly links: LinkContent;
  private readonly references: ReferenceContent;
  private readonly texts = new TextTargets();
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Target of the visible popup, and the one whose delay is running. */
  private open: HoverTarget | null = null;
  private pending: HoverTarget | null = null;
  /** Identifies the current pending/visible popup; async work belonging to an older one is dropped. */
  private attempt = 0;
  private lastMove: { run: HTMLElement; x: number; y: number } | null = null;
  private moveFrame = 0;

  constructor(
    private readonly ctx: ReaderContext,
    resolver: CitationResolver,
    floats: FloatResolver,
    private readonly preview: DestPreview,
  ) {
    this.links = new LinkContent(ctx, resolver, preview);
    this.references = new ReferenceContent(ctx, resolver, floats, preview);
    const viewer = byId("viewer");
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
   * Cancels any pending open, hides the popup and discards in-flight preview work.
   * @returns void
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
  private schedule(target: HoverTarget, prepare: (isCurrent: () => boolean) => Promise<PopupContent | null>): void {
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
    const left = (target: HoverTarget | null): boolean =>
      target !== null && target.group.some((g) => g.contains(from))
      && !(to !== null && (this.popup.contains(to) || target.group.some((g) => g.contains(to))));
    if (left(this.pending)) { this.cancelPending(); }
    if (left(this.open)) { this.scheduleClose(); }
  }

  private onOver(e: MouseEvent): void {
    if (!this.enabled) { return; }
    const link = findLink(e);
    if (!link) { return; }
    const target = linkHoverTarget(link);
    if (sameTarget(target, this.open)) { this.cancelClose(); return; }
    if (sameTarget(target, this.pending)) { return; }
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
    if (target && sameTarget(target, this.open)) { this.cancelClose(); return; }
    // Inside a long run the pointer can leave a reference without leaving the element, so no mouseout says so.
    if (this.open?.ref && this.open.group.includes(move.run) && !this.closeTimer) { this.scheduleClose(); }
    if (!target) {
      if (this.pending?.ref) { this.cancelPending(); }
      return;
    }
    if (sameTarget(target, this.pending)) { return; }
    this.schedule(target, (isCurrent) => this.references.prepareText(target, isCurrent));
  }

  private show(target: HoverTarget, content: PopupContent): void {
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
