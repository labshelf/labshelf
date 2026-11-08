// The stage controls of a compiled (LaTeX or Typst) poster over its built page: a block drags to another column or place with a drop bar
// and is moved on release, and the strip between two columns drags to new ratios on release. Geometry comes from the port in page pt
// from the page's top-left corner; the element is laid over the page at `scale()` px per pt.
import { renderElement } from "../../../ui/dom/index.js";

type Columns = NonNullable<ReturnType<SourcePosterStagePort["columns"]>>;
type Place = { column: number; index: number };

export interface SourcePosterStagePort { columns(): { left: number; width: number; blocks: { key: string; top: number; height: number }[] }[] | null; scale(): number; enabled(): boolean; move(from: { column: number; index: number }, to: { column: number; index: number }): void; resize(gap: number, deltaPt: number): void; suppressClick(): void }

const DRAG_THRESHOLD = 4;
const BAR = 4;

/** A press in progress: on a block (`from`) or on the gap handle `gap`, with where it started in client px. */
type Press =
  | { type: "block"; from: Place; x: number; y: number; dragging: boolean; slot: Place | undefined }
  | { type: "gap"; gap: number; handle: HTMLElement; x: number; moved: boolean; deltaPt: number };

/** One stage: its elements, the columns last shown, the press in progress and the window listeners that follow it. */
interface StageRuntime {
  port: SourcePosterStagePort;
  element: HTMLElement;
  blocks: HTMLElement;
  gaps: HTMLElement;
  drop: HTMLElement;
  shown: Columns | null;
  press: Press | undefined;
  listeners: { move(event: PointerEvent): void; up(): void; end(): void; key(event: KeyboardEvent): void };
}

/** The slot a pointer at (x, y) pt picks: the nearest column by x, before the first other block whose centre is below y. */
function slotAt(columns: Columns, from: Place, x: number, y: number): Place {
  let column = 0; let best = Infinity;
  columns.forEach((c, i) => {
    const distance = x < c.left ? c.left - x : x > c.left + c.width ? x - (c.left + c.width) : 0;
    if (distance < best) { best = distance; column = i; }
  });
  const others = columns[column]!.blocks.filter((_, i) => column !== from.column || i !== from.index);
  const index = others.findIndex((block) => block.top + block.height / 2 > y);
  return { column, index: index === -1 ? others.length : index };
}

/** Where the drop bar of `slot` goes, in pt: across the column, in the middle of the space before the slot's block (or after the last). */
function barAt(columns: Columns, from: Place, slot: Place): { left: number; top: number; width: number } {
  const column = columns[slot.column]!;
  const others = column.blocks.filter((_, i) => slot.column !== from.column || i !== from.index);
  const next = others[slot.index]; const previous = others[slot.index - 1];
  const top = next && previous ? (previous.top + previous.height + next.top) / 2 : next ? next.top - BAR : previous ? previous.top + previous.height + BAR : column.blocks[0]?.top ?? 0;
  return { left: column.left, top, width: column.width };
}

const px = (pt: number, scale: number): string => `${pt * scale}px`;

function pointOf(rt: StageRuntime, event: MouseEvent): { x: number; y: number } {
  const bounds = rt.element.getBoundingClientRect();
  const scale = rt.port.scale() || 1;
  return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
}

function endPress(rt: StageRuntime): void {
  const { press } = rt;
  if (press?.type === "gap") { press.handle.classList.remove("is-active"); press.handle.style.transform = ""; }
  rt.press = undefined;
  rt.drop.hidden = true;
  window.removeEventListener("pointermove", rt.listeners.move, true);
  window.removeEventListener("pointerup", rt.listeners.up, true);
  window.removeEventListener("pointercancel", rt.listeners.end, true);
  window.removeEventListener("keydown", rt.listeners.key, true);
}

/** Moves the drop bar to the slot under the pointer once a block press has passed the drag threshold. */
function dragBlock(rt: StageRuntime, press: Extract<Press, { type: "block" }>, shown: Columns, event: PointerEvent): void {
  if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= DRAG_THRESHOLD) return;
  press.dragging = true;
  const point = pointOf(rt, event);
  press.slot = slotAt(shown, press.from, point.x, point.y);
  const bar = barAt(shown, press.from, press.slot);
  const scale = rt.port.scale();
  Object.assign(rt.drop.style, { left: `${bar.left * scale}px`, top: `${bar.top * scale - BAR / 2}px`, width: `${bar.width * scale}px`, height: `${BAR}px` });
  rt.drop.hidden = false;
}

function onMove(rt: StageRuntime, event: PointerEvent): void {
  const { press, shown } = rt;
  if (!press || !shown) return;
  if (press.type === "block") { dragBlock(rt, press, shown, event); return; }
  const deltaPx = event.clientX - press.x;
  press.moved ||= deltaPx !== 0;
  press.deltaPt = deltaPx / (rt.port.scale() || 1);
  press.handle.classList.add("is-active");
  press.handle.style.transform = `translateX(${deltaPx}px)`;
}

function onUp(rt: StageRuntime): void {
  const { port } = rt;
  const done = rt.press;
  endPress(rt);
  if (!done) return;
  if (done.type === "gap") {
    if (!done.moved) return;
    port.suppressClick();
    if (done.deltaPt !== 0) port.resize(done.gap, done.deltaPt);
    return;
  }
  if (!done.dragging) return;
  port.suppressClick();
  const { from, slot } = done;
  if (slot && (slot.column !== from.column || slot.index !== from.index)) port.move(from, slot);
}

function onKey(rt: StageRuntime, event: KeyboardEvent): void {
  if (event.key !== "Escape" || !rt.press) return;
  event.preventDefault();
  endPress(rt);
}

function onPointerDown(rt: StageRuntime, event: PointerEvent): void {
  if (event.button !== 0 || !rt.shown || rt.press) return;
  const target = event.target as HTMLElement;
  const handle = target.closest<HTMLElement>("[data-gap]");
  const hit = target.closest<HTMLElement>("[data-column]");
  if (handle) {
    rt.press = { type: "gap", gap: Number(handle.dataset["gap"]), handle, x: event.clientX, moved: false, deltaPt: 0 };
    event.preventDefault();
  } else if (hit) {
    rt.press = { type: "block", from: { column: Number(hit.dataset["column"]), index: Number(hit.dataset["index"]) }, x: event.clientX, y: event.clientY, dragging: false, slot: undefined };
  } else return;
  window.addEventListener("pointermove", rt.listeners.move, true);
  window.addEventListener("pointerup", rt.listeners.up, true);
  window.addEventListener("pointercancel", rt.listeners.end, true);
  window.addEventListener("keydown", rt.listeners.key, true);
}

/** One transparent hit box per block, placed in page pt at `scale` px per pt. */
function blockHits(columns: Columns, scale: number): HTMLElement[] {
  return columns.flatMap((column, c) => column.blocks.map((block, b) => {
    const hit = renderElement("div", { class: "dsh-source-poster-block", "data-column": String(c), "data-index": String(b), "data-key": block.key });
    Object.assign(hit.style, { left: px(column.left, scale), top: px(block.top, scale), width: px(column.width, scale), height: px(block.height, scale) });
    return hit;
  }));
}

/** One resize handle per strip between two neighbouring columns, as tall as the blocks of both. */
function gapHandles(columns: Columns, scale: number): HTMLElement[] {
  return columns.slice(1).map((next, i) => {
    const previous = columns[i]!;
    const right = previous.left + previous.width;
    const all = [...previous.blocks, ...next.blocks];
    const top = Math.min(...all.map((b) => b.top), Infinity);
    const bottom = Math.max(...all.map((b) => b.top + b.height), -Infinity);
    const handle = renderElement("div", { class: "dsh-poster-gap dsh-poster-gap-column", role: "separator", "aria-orientation": "vertical", "aria-label": `Resize columns ${i + 1} and ${i + 2}`, "data-gap": String(i) });
    Object.assign(handle.style, { left: px(right, scale), width: px(Math.max(0, next.left - right), scale), top: px(Number.isFinite(top) ? top : 0, scale), height: px(Number.isFinite(bottom) ? bottom - top : 0, scale) });
    return handle;
  });
}

function renderStage(rt: StageRuntime): void {
  const { port, element, blocks, gaps } = rt;
  const shown = port.enabled() ? port.columns() : null;
  rt.shown = shown;
  element.hidden = shown === null;
  if (!shown) { endPress(rt); blocks.replaceChildren(); gaps.replaceChildren(); return; }
  const scale = port.scale();
  blocks.replaceChildren(...blockHits(shown, scale));
  gaps.replaceChildren(...gapHandles(shown, scale));
}

function createRuntime(port: SourcePosterStagePort): StageRuntime {
  const blocks = renderElement("div", { class: "dsh-source-poster-blocks" });
  const gaps = renderElement("div", { class: "dsh-source-poster-gaps" });
  const drop = renderElement("div", { class: "dsh-poster-drop", hidden: true });
  const element = renderElement("div", { class: "dsh-poster dsh-source-poster", hidden: true }, blocks, gaps, drop);
  const rt: StageRuntime = {
    port, element, blocks, gaps, drop, shown: null, press: undefined,
    listeners: { move: (event) => onMove(rt, event), up: () => onUp(rt), end: () => endPress(rt), key: (event) => onKey(rt, event) },
  };
  return rt;
}

export function createSourcePosterStage(port: SourcePosterStagePort): { element: HTMLElement; render(): void; destroy(): void } {
  const rt = createRuntime(port);
  rt.element.addEventListener("pointerdown", (event) => onPointerDown(rt, event));
  return { element: rt.element, render() { renderStage(rt); }, destroy: rt.listeners.end };
}
