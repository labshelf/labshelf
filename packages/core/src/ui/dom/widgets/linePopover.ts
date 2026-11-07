/**
 * The popover an editor's gutter or lens button opens beside its line: one at a time in the page, the same button toggles it,
 * and Escape, a click outside or a scroll outside close it, handing focus back to the button.
 */

const GAP_PX = 4;

interface OpenPopover { anchor: HTMLElement; close(): void }
// INVARIANT: at most one line popover is open in the page.
let active: OpenPopover | undefined;

export interface LinePopoverOptions {
  /** The element the popover is appended to, such as the editor's root, so the editor's theme reaches it. */
  host: HTMLElement;
  anchor: HTMLElement;
  /** The popover's class names besides `ls-line-popover`. */
  className: string;
  label: string;
  /** Where focus goes on close when the anchor is gone, such as the editor's content. */
  fallbackFocus: HTMLElement;
  /** `beside` puts it right of the anchor (a gutter button), `below` under it (a lens over the line). */
  place: "beside" | "below";
  /** Builds the content; `close` closes the popover, for a button inside it. */
  render(close: () => void): Node[];
}

function placePopover(popover: HTMLElement, anchor: HTMLElement, place: LinePopoverOptions["place"]): void {
  const anchorBox = anchor.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const left = place === "beside" ? anchorBox.right + GAP_PX : anchorBox.left;
  const top = place === "beside" ? anchorBox.top : anchorBox.bottom + GAP_PX;
  popover.style.left = `${Math.max(0, Math.min(left, window.innerWidth - box.width))}px`;
  popover.style.top = `${Math.max(0, Math.min(top, window.innerHeight - box.height))}px`;
}

/** Opens the popover, or closes it when it is already open on `anchor`. */
export function toggleLinePopover({ host, anchor, className, label, fallbackFocus, place, render }: LinePopoverOptions): void {
  const toggledOff = active?.anchor === anchor;
  active?.close();
  if (toggledOff) return;
  const popover = document.createElement("div");
  popover.className = `ls-line-popover ${className}`;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", label);
  popover.tabIndex = -1;
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("scroll", onScroll, true);
    const hadFocus = popover.contains(document.activeElement);
    popover.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (active?.anchor === anchor) active = undefined;
    if (hadFocus) (anchor.isConnected ? anchor : fallbackFocus).focus();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onPointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !popover.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onScroll = (event: Event): void => { if (!(event.target instanceof Node && popover.contains(event.target))) close(); };
  popover.append(...render(close));
  host.append(popover);
  placePopover(popover, anchor, place);
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("scroll", onScroll, true);
  active = { anchor, close };
  popover.focus();
}
