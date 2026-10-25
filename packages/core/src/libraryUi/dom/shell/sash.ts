// Resizes collapsible panes with pointer handles.
import { renderIcon } from "../../../ui/index.js";

export interface SashOptions {
  root: HTMLElement;
  pane: HTMLElement;
  collapsedClass: string;
  limits: { min: number; max: number; collapseAt: number };
  widthFromPointer: (clientX: number) => number;
  persist: (width: number, collapsed: boolean) => void;
  /** The width a double-click returns to; without it a double-click only restores a collapsed pane. */
  defaultWidth?: number;
}

/** Wires one sash. The sash captures the pointer so a drag over an iframe still ends with the button. */
export function attachSash(sash: HTMLElement, o: SashOptions): void {
  sash.insertAdjacentHTML("afterbegin", `<span class="ls-sash-grip" aria-hidden="true">${renderIcon("more")}</span>`);
  let dragging = false;
  const width = (): number => parseInt(o.pane.style.width, 10) || o.limits.min;
  sash.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || dragging) return;
    dragging = true;
    sash.setPointerCapture(e.pointerId);
    sash.classList.add("dragging");
    o.root.classList.add("resizing");
    e.preventDefault();
  });
  sash.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const desired = o.widthFromPointer(e.clientX);
    if (desired < o.limits.collapseAt) { o.root.classList.add(o.collapsedClass); return; }
    o.root.classList.remove(o.collapsedClass);
    o.pane.style.width = `${Math.min(o.limits.max, Math.max(o.limits.min, desired))}px`;
  });
  // Releasing capture fires lostpointercapture, so every way a drag ends reaches the same handler.
  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    sash.classList.remove("dragging");
    o.root.classList.remove("resizing");
    o.persist(width(), o.root.classList.contains(o.collapsedClass));
  };
  sash.addEventListener("pointerup", end);
  sash.addEventListener("pointercancel", end);
  sash.addEventListener("lostpointercapture", end);
  sash.addEventListener("dblclick", () => {
    o.root.classList.remove(o.collapsedClass);
    if (o.defaultWidth) o.pane.style.width = `${o.defaultWidth}px`;
    o.persist(width(), false);
  });
}
