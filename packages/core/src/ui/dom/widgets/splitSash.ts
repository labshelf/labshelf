// The sash of a two-card split (an article's code beside its PDF preview): the library's grip, dragged to set the first card's share of the split.
import { renderIcon } from "../../icons/index.js";

/** The custom property on the split host that holds the first card's width, as a percentage. */
export const SPLIT_WIDTH_PROPERTY = "--ls-split-code";

const MIN_PERCENT = 20;
const MAX_PERCENT = 80;

export interface SplitSashOptions {
  /** Runs once a drag ends, with the width the drag left (`"42.5%"`), for the host to remember. */
  onEnd?: (width: string) => void;
}

/**
 * Wires `sash` to resize the first card of `host` between 20% and 80% of its width, through {@link SPLIT_WIDTH_PROPERTY}.
 * The sash captures the pointer, so a drag over the PDF's canvas still ends with the button.
 */
export function attachSplitSash(sash: HTMLElement, host: HTMLElement, options: SplitSashOptions = {}): void {
  sash.insertAdjacentHTML("afterbegin", `<span class="ls-sash-grip" aria-hidden="true">${renderIcon("more")}</span>`);
  let dragging = false;
  sash.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || dragging) return;
    dragging = true;
    sash.setPointerCapture?.(event.pointerId);
    sash.classList.add("dragging");
    event.preventDefault();
  });
  sash.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const bounds = host.getBoundingClientRect();
    if (bounds.width === 0) return;
    const percent = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, ((event.clientX - bounds.left) / bounds.width) * 100));
    host.style.setProperty(SPLIT_WIDTH_PROPERTY, `${percent}%`);
  });
  // Releasing capture fires lostpointercapture, so every way a drag ends reaches the same handler.
  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    sash.classList.remove("dragging");
    const width = host.style.getPropertyValue(SPLIT_WIDTH_PROPERTY);
    if (width) options.onEnd?.(width);
  };
  sash.addEventListener("pointerup", end);
  sash.addEventListener("pointercancel", end);
  sash.addEventListener("lostpointercapture", end);
}
