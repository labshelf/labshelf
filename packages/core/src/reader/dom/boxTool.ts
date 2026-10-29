// Runs the text-box creation mode: a click fits a box into the empty space around it, a drag draws one.
import { formatAnchor } from "../../qmd/item/index.js";
import { fitEmptyBox, snapBox, type PageRect } from "../textBoxPlacement.js";
import { collectPageRects, showDraft } from "./noteBoxes.js";
import { derivePageFrame } from "./pageHighlights.js";
import type { ReaderContext } from "./readerSession.js";

const MODE_CLASS = "rd-box-mode";
/** Pointer travel in pixels below which a press counts as a click. */
const DRAG_PX = 4;

export class BoxTool {
  /** Called when the mode turns on or off, so the toolbar button can follow. */
  onChange: ((on: boolean) => void) | null = null;
  /** Called with the anchor of a box just sent to the host, so the layer opens it once it arrives. */
  onCreate: ((anchor: string) => void) | null = null;
  private on = false;

  constructor(private readonly ctx: ReaderContext) {
    ctx.container.addEventListener("pointerdown", (e) => this.pointerDown(e), true);
    document.addEventListener("keydown", (e) => {
      if (this.on && e.key === "Escape") { this.setActive(false); }
    }, true);
  }

  get active(): boolean { return this.on; }

  setActive(on: boolean): void {
    if (this.on === on) { return; }
    this.on = on;
    this.ctx.container.classList.toggle(MODE_CLASS, on);
    this.onChange?.(on);
  }

  toggle(): void { this.setActive(!this.on); }

  private pointerDown(down: PointerEvent): void {
    if (!this.on || down.button !== 0 || !(down.target instanceof Element)) { return; }
    if (down.target.closest(".rd-note-box")) { return; }
    const page = down.target.closest<HTMLElement>(".page");
    const pageNumber = Number(page?.dataset["pageNumber"]);
    const frame = page && derivePageFrame(page);
    if (!page || !frame || !Number.isSafeInteger(pageNumber)) { return; }
    down.preventDefault();
    down.stopPropagation();
    const at = (e: PointerEvent): { x: number; y: number } => ({
      x: clamp01((e.clientX - frame.left) / frame.width),
      y: clamp01((e.clientY - frame.top) / frame.height),
    });
    const origin = at(down);
    const rects = collectPageRects(page);
    let draft: PageRect | null = null;
    const onMove = (e: PointerEvent): void => {
      if (draft === null && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_PX) { return; }
      const p = at(e);
      draft = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) };
      showDraft(page, draft);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      showDraft(page, null);
      // A click where nothing fits creates nothing and leaves the mode on.
      const box = draft ? snapBox(draft, rects) : fitEmptyBox(origin, rects);
      if (box) { this.create(pageNumber, box); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private create(page: number, box: PageRect): void {
    let anchor: string;
    try {
      anchor = formatAnchor({ kind: "box", page, ...box });
    } catch {
      // A drag snapped to no area is not a valid anchor; the mode stays on for another try.
      return;
    }
    this.onCreate?.(anchor);
    this.ctx.host.post({ command: "addNote", anchor, body: "" });
    this.setActive(false);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
