// The poster stage of a sectioned HTML poster: an overlay in .dsh-centre over the editor's stage. A press on a section box drags the section
// to a slot of any column (a blue drop bar shows where) and commits movePosterSection; the gaps between columns and between sections are
// handles that drag to resize their neighbours (resizePosterGap). Section and header boxes are locked: no free move, no resize handles.
import { renderElement } from "../../../../ui/dom/index.js";
import { posterBody, readPosterLayout, type PosterBox, type PosterGap, type PosterLayout } from "../../../posterSections.js";
import { movePosterSection, resizePosterGap, type PosterEditResult } from "../../../posterSectionEdits.js";
import type { ShellContext } from "../html/types.js";

/** Pointer movement in screen px before a press on a section becomes a drag. */
const DRAG_THRESHOLD = 4;
const DROP_HEIGHT = 4;

interface Point { x: number; y: number }
interface SectionGesture { kind: "section"; id: string; draggable: boolean; origin: Point; from: { column: number; index: number }; slot: { column: number; index: number } | null }
interface GapGesture { kind: "gap"; gap: PosterGap; handle: HTMLElement; origin: Point; delta: number }
type Gesture = SectionGesture | GapGesture;

/** The layout of the view when it is a sectioned poster, else null. */
function layoutOf(ctx: ShellContext): PosterLayout | null {
  return ctx.view.model?.kind === "poster" ? readPosterLayout(ctx.view.html, ctx.view.theme) : null;
}

/** The slot under the slide point `at` for the dragged section `id`: the column holding the pointer's x (the nearest one in a margin), before the first other section whose centre is below it. */
function slotAt(layout: PosterLayout, id: string, at: Point): { column: number; index: number } {
  const body = posterBody(layout.width, layout.height, layout.settings, layout.header !== null);
  let column = 0;
  let best = Infinity;
  for (const [index, range] of body.columns.entries()) {
    const distance = at.x < range.left ? range.left - at.x : at.x > range.left + range.width ? at.x - range.left - range.width : 0;
    if (distance < best) { best = distance; column = index; }
  }
  const others = (layout.columns[column] ?? []).filter((box) => box.id !== id);
  const below = others.findIndex((box) => box.rect.top + box.rect.height / 2 > at.y);
  return { column, index: below === -1 ? others.length : below };
}

/** The section's own column and index among the other sections of that column. */
function slotOf(layout: PosterLayout, id: string): { column: number; index: number } {
  for (const [column, boxes] of layout.columns.entries()) {
    const index = boxes.findIndex((box) => box.id === id);
    if (index !== -1) return { column, index };
  }
  return { column: -1, index: -1 };
}

/** The drop bar's rect in slide px for a slot: at the top of the section it goes before, or under the column's last section. */
function dropRect(layout: PosterLayout, id: string, slot: { column: number; index: number }): { left: number; top: number; width: number } {
  const body = posterBody(layout.width, layout.height, layout.settings, layout.header !== null);
  const range = body.columns[slot.column]!;
  const others = (layout.columns[slot.column] ?? []).filter((box) => box.id !== id);
  const half = layout.settings.sectionMargin / 2;
  const next = others[slot.index];
  const last = others[others.length - 1];
  const top = next ? next.rect.top - half : last ? last.rect.top + last.rect.height + half : body.top;
  return { left: range.left, top, width: range.width };
}

/** Commits a poster edit as one change; a failed one shows its error as the editor notice. */
export function commitPosterEdit(ctx: ShellContext, result: PosterEditResult, label: string): void {
  if (result.ok) ctx.editor.replace(result.html, result.theme, label);
  else ctx.editor.edit([() => result], label);
}

export function createPosterStage(ctx: ShellContext): { element: HTMLElement; render(): void; destroy(): void } {
  const element = renderElement("div", { class: "dsh-poster" });
  const drop = renderElement("div", { class: "dsh-poster-drop", hidden: true, "aria-hidden": "true" });
  let layout: PosterLayout | null = null;
  let gesture: Gesture | null = null;

  const offset = (): { left: number; top: number } => {
    const stage = ctx.editor.stage.getBoundingClientRect();
    const host = element.offsetParent?.getBoundingClientRect() ?? element.parentElement?.getBoundingClientRect() ?? stage;
    return { left: stage.left - host.left, top: stage.top - host.top };
  };
  const toSlide = (event: MouseEvent): Point => {
    const stage = ctx.editor.stage.getBoundingClientRect();
    const scale = ctx.view.scale || 1;
    return { x: (event.clientX - stage.left) / scale, y: (event.clientY - stage.top) / scale };
  };
  const setDragging = (on: boolean): void => {
    ctx.editor.element.classList.toggle("is-dragging", on);
    ctx.editor.element.closest<HTMLElement>(".dsh")?.classList.toggle("is-dragging", on);
  };

  const showDrop = (slot: { column: number; index: number } | null, id: string): void => {
    if (!slot || !layout) { drop.hidden = true; return; }
    const rect = dropRect(layout, id, slot);
    const { left, top } = offset();
    const { scale } = ctx.view;
    Object.assign(drop.style, { left: `${left + rect.left * scale}px`, top: `${top + rect.top * scale - DROP_HEIGHT / 2}px`, width: `${rect.width * scale}px`, height: `${DROP_HEIGHT}px` });
    drop.hidden = false;
  };

  const placeGap = (el: HTMLElement, gap: PosterGap, delta = 0): void => {
    const { left, top } = offset();
    const { scale } = ctx.view;
    const dx = gap.kind === "column" ? delta : 0;
    const dy = gap.kind === "section" ? delta : 0;
    Object.assign(el.style, { left: `${left + gap.rect.left * scale + dx}px`, top: `${top + gap.rect.top * scale + dy}px`, width: `${gap.rect.width * scale}px`, height: `${gap.rect.height * scale}px` });
  };

  const stop = (): void => {
    gesture = null;
    drop.hidden = true;
    setDragging(false);
    element.querySelector(".dsh-poster-gap.is-active")?.classList.remove("is-active");
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const start = (next: Gesture): void => {
    gesture = next;
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
  };

  function onMove(event: PointerEvent): void {
    const current = gesture;
    if (!current || !layout) return;
    if (current.kind === "gap") {
      const screen = current.gap.kind === "column" ? event.clientX - current.origin.x : event.clientY - current.origin.y;
      current.delta = screen / (ctx.view.scale || 1);
      placeGap(current.handle, current.gap, screen);
      return;
    }
    if (!current.draggable) return;
    if (!current.slot && Math.hypot(event.clientX - current.origin.x, event.clientY - current.origin.y) < DRAG_THRESHOLD) return;
    current.slot = slotAt(layout, current.id, toSlide(event));
    setDragging(true);
    showDrop(current.slot, current.id);
  }
  function onUp(): void {
    const current = gesture;
    stop();
    if (!current) return;
    if (current.kind === "gap") {
      if (current.delta !== 0) commitPosterEdit(ctx, resizePosterGap(ctx.view.html, ctx.view.theme, current.gap, current.delta), current.gap.kind === "column" ? "Resize columns" : "Resize sections");
      return;
    }
    const { slot, from } = current;
    if (!slot || (slot.column === from.column && slot.index === from.index)) return;
    commitPosterEdit(ctx, movePosterSection(ctx.view.html, ctx.view.theme, current.id, slot.column, slot.index), "Move section");
  }
  function onCancel(): void { stop(); }
  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !gesture) return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture.kind === "gap") placeGap(gesture.handle, gesture.gap);
    stop();
  }

  /** Takes presses on header and section boxes (and their handles) before the editor's stage starts a free drag, resize or marquee. */
  const onPress = (event: PointerEvent): void => {
    if (!layout || gesture || event.button !== 0 || ctx.view.readOnly || ctx.editor.element.classList.contains("is-hand")) return;
    const id = event.target instanceof Element ? event.target.closest("[data-block-box]")?.getAttribute("data-block-box") : null;
    const box: PosterBox | undefined = id ? [...(layout.header ? [layout.header] : []), ...layout.columns.flat()].find((entry) => entry.id === id) : undefined;
    if (!box) return;
    event.stopPropagation();
    event.preventDefault();
    ctx.editor.selectBlocks([box.id]);
    const from = slotOf(layout, box.id);
    start({ kind: "section", id: box.id, draggable: box.role === "section", origin: { x: event.clientX, y: event.clientY }, from, slot: null });
  };
  ctx.editor.viewport.addEventListener("pointerdown", onPress, true);

  const gapHandle = (gap: PosterGap): HTMLElement => {
    const handle = renderElement("div", {
      class: `dsh-poster-gap dsh-poster-gap-${gap.kind}`, role: "separator", "aria-orientation": gap.kind === "column" ? "vertical" : "horizontal",
      "aria-label": gap.kind === "column" ? "Resize columns" : "Resize sections",
      "data-gap-kind": gap.kind, "data-gap-index": String(gap.index), "data-gap-column": String(gap.column),
    });
    handle.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (event.button !== 0 || ctx.view.readOnly || gesture) return;
      event.preventDefault();
      if ("pointerId" in event && typeof handle.setPointerCapture === "function") try { handle.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
      handle.classList.add("is-active");
      start({ kind: "gap", gap, handle, origin: { x: event.clientX, y: event.clientY }, delta: 0 });
    });
    placeGap(handle, gap);
    return handle;
  };

  const markLocked = (): void => {
    const locked = new Set(layout ? [...(layout.header ? [layout.header.id] : []), ...layout.columns.flat().map((box) => box.id)] : []);
    for (const box of Array.from(ctx.editor.stage.querySelectorAll<HTMLElement>("[data-block-box]"))) box.classList.toggle("dsh-poster-locked", locked.has(box.getAttribute("data-block-box") ?? ""));
  };

  return {
    element,
    render() {
      layout = layoutOf(ctx);
      markLocked();
      if (gesture?.kind === "gap") return;
      if (!layout) { if (gesture) stop(); element.replaceChildren(); return; }
      element.replaceChildren(...layout.gaps.map(gapHandle), drop);
      if (gesture?.kind === "section" && gesture.slot) showDrop(gesture.slot, gesture.id);
    },
    destroy() {
      stop();
      ctx.editor.viewport.removeEventListener("pointerdown", onPress, true);
      element.remove();
    },
  };
}
