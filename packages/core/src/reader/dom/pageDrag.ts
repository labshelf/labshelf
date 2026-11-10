// Starts and follows a pointer drag over a page, for the tools that draw a box on it.
import { derivePageFrame } from "./pageHighlights.js";

/** A press on a page: which page, where its content box is, and where the pointer went down in page fractions. */
export interface PageDrag {
  page: HTMLElement;
  pageNumber: number;
  frame: NonNullable<ReturnType<typeof derivePageFrame>>;
  origin: { x: number; y: number };
  /** The pointer's position in page fractions (0..1, origin top-left), clamped to the page. */
  at(e: PointerEvent): { x: number; y: number };
}

/**
 * @returns the drag a left-button press starts on a page, or null when the press is elsewhere; a drag it returns has had its
 * default action and propagation stopped, so the page below does not select text or scroll.
 */
export function beginPageDrag(down: PointerEvent): PageDrag | null {
  if (down.button !== 0 || !(down.target instanceof Element)) { return null; }
  const page = down.target.closest<HTMLElement>(".page");
  const pageNumber = Number(page?.dataset["pageNumber"]);
  const frame = page && derivePageFrame(page);
  if (!page || !frame || !Number.isSafeInteger(pageNumber)) { return null; }
  down.preventDefault();
  down.stopPropagation();
  const at = (e: PointerEvent): { x: number; y: number } => ({
    x: clamp01((e.clientX - frame.left) / frame.width),
    y: clamp01((e.clientY - frame.top) / frame.height),
  });
  return { page, pageNumber, frame, origin: at(down), at };
}

/** Calls `onMove` for each pointer move until the pointer is released, then `onUp` once. */
export function trackPointer(onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void): void {
  const up = (e: PointerEvent): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    onUp(e);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
