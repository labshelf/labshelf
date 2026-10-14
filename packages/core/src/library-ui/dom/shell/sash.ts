/**
 * The drag handles beside the side panes: dragging resizes a pane, dragging below its threshold collapses it, and a
 * double-click restores a collapsed one.
 */
export interface SashOptions {
  root: HTMLElement;
  pane: HTMLElement;
  collapsedClass: string;
  limits: { min: number; max: number; collapseAt: number };
  widthFromPointer: (clientX: number) => number;
  persist: (width: number, collapsed: boolean) => void;
}

/** Wires one sash; returns the function that removes its window listeners. */
export function attachSash(sash: HTMLElement, o: SashOptions): () => void {
  let dragging = false;
  const width = (): number => parseInt(o.pane.style.width, 10) || o.limits.min;
  sash.addEventListener("mousedown", (e) => {
    dragging = true;
    sash.classList.add("dragging");
    o.root.classList.add("resizing");
    e.preventDefault();
  });
  const onMove = (e: MouseEvent): void => {
    if (!dragging) return;
    const desired = o.widthFromPointer(e.clientX);
    if (desired < o.limits.collapseAt) { o.root.classList.add(o.collapsedClass); return; }
    o.root.classList.remove(o.collapsedClass);
    o.pane.style.width = `${Math.min(o.limits.max, Math.max(o.limits.min, desired))}px`;
  };
  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    sash.classList.remove("dragging");
    o.root.classList.remove("resizing");
    o.persist(width(), o.root.classList.contains(o.collapsedClass));
  };
  sash.addEventListener("dblclick", () => {
    o.root.classList.remove(o.collapsedClass);
    o.persist(width(), false);
  });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
}
