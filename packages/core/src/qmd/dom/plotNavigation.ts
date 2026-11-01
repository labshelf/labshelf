// Moves a drawn interactive plot with the trackpad, mouse wheel and keyboard: pinch and Ctrl/Cmd+wheel zoom about the
// cursor, a two-finger scroll pans while the plot is active, arrows pan or rotate, and button zooms ease in over a few frames.
import { renderElement } from "../../ui/dom/index.js";
import type { PlotHandle } from "./plotRender.js";
import {
  blendPlotView, defaultDragMode, DEFAULT_PLOT_VIEW_3D, panPlotView, plotPointAt, plotViewUpdate, readPlotArea, readPlotView,
  PLOT_SURFACE_STYLES, rotatePlotView, zoomPlotView, type PlotDragMode, type PlotView, type PlotZoomDirection,
} from "./plotView.js";

export interface PlotNavigation {
  readonly mode: PlotDragMode;
  readonly active: boolean;
  /** Zooms one step about the centre of the view, eased over a few frames. */
  zoom(direction: PlotZoomDirection): void;
  resetView(): void;
  autoscale(): void;
  setMode(mode: PlotDragMode): void;
  /** Toggles box zoom (2D) or free orbit (3D) against the default drag. */
  toggleAlternate(): void;
  /** Toggles pan against the rotate drag in 3D; picks pan in 2D. */
  togglePan(): void;
  /** Steps a 3D plot's surfaces through Surface, Wireframe and Surface + wireframe; the last two only when the wireframe fits. */
  toggleSurfaceStyle(): void;
  /** Toggles a 3D plot's surface colouring between its single colour and by height. */
  toggleSurfaceColour(): void;
  /** Takes the default drag of the drawn spec's dimensions after an update changed them. */
  syncDim(): void;
  destroy(): void;
}

export interface PlotNavigationOptions {
  /** The element whose area keeps the plot active: the root and its buttons. */
  zone: HTMLElement;
  /** The expanded overlay's plot is active as long as it is open. */
  alwaysActive?: boolean;
  onChange?(): void;
}

/** How much one zoom step (button or key) scales a 2D span or the 3D camera distance, zooming in. */
const STEP_ZOOM_2D = 0.6;
const STEP_ZOOM_3D = 0.8;
/** An arrow key pans by this share of the span, with Shift the larger one; in 3D it turns the camera by the angle. */
const PAN_STEP = 0.1;
const PAN_STEP_LARGE = 0.5;
const TURN_STEP = Math.PI / 24;
const TURN_STEP_LARGE = Math.PI / 6;
/** How long an eased step takes. */
const STEP_MS = 150;
/** A wheel delta becomes a zoom factor of exp(delta * rate); a trackpad pinch sends small deltas, so it gets the faster rate. */
const WHEEL_RATE = 0.002;
const PINCH_RATE = 0.01;
const PINCH_DELTA = 50;
const MAX_WHEEL_FACTOR = 2;
const HINT_MS = 1500;
/** The px one wheel line stands for. */
const LINE_PX = 16;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

function isMac(doc: Document): boolean {
  const nav = doc.defaultView?.navigator;
  return /Mac|iPhone|iPad/.test(nav?.platform ?? nav?.userAgent ?? "");
}

/** The wheel's deltas in px, whatever unit the device reports. */
function wheelPx(event: WheelEvent, page: number): { dx: number; dy: number } {
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? page : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
}

interface Animation { from: PlotView; to: PlotView; start: number; shown: PlotView }

export function attachPlotNavigation(root: HTMLElement, handle: PlotHandle, options: PlotNavigationOptions): PlotNavigation {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const now = (): number => win.performance?.now() ?? Date.now();
  const requestFrame = (run: (time: number) => void): void => {
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(run);
    else win.setTimeout(() => run(now()), 16);
  };
  const always = options.alwaysActive === true;
  let active = false;
  let mode: PlotDragMode = defaultDragMode(handle.dim);
  let rotateMode: PlotDragMode = mode === "orbit" ? "orbit" : "turntable";
  let shownDim = handle.dim;
  let destroyed = false;
  /** The view the next frame shows, coalescing every event since the last one. */
  let target: PlotView | null = null;
  let animation: Animation | null = null;
  let framePending = false;
  /** The last view handed to Plotly and how many of those relayouts are still running. */
  let sent: PlotView | null = null;
  let inFlight = 0;
  let hint: HTMLElement | null = null;
  let hintShown = false;
  let hintTimer = 0;

  const changed = (): void => options.onChange?.();

  const setActive = (next: boolean): void => {
    const value = always || next;
    if (value === active) return;
    active = value;
    root.classList.toggle("is-active", value);
    changed();
  };

  const send = (view: PlotView): void => {
    sent = view;
    inFlight++;
    handle.relayout(plotViewUpdate(view)).catch(() => undefined).finally(() => { inFlight--; });
  };

  const tick = (time: number): void => {
    framePending = false;
    if (destroyed) return;
    if (animation) {
      const t = Math.min(1, Math.max(0, (time - animation.start) / STEP_MS));
      const view = t >= 1 ? animation.to : blendPlotView(animation.from, animation.to, easeOut(t));
      animation.shown = view;
      if (t >= 1) animation = null;
      else schedule();
      send(view);
      return;
    }
    if (target) {
      const view = target;
      target = null;
      send(view);
    }
  };

  function schedule(): void {
    if (framePending || destroyed) return;
    framePending = true;
    requestFrame(tick);
  }

  /** The view a new gesture starts from: the queued one, else the last sent while Plotly applies it, else the drawn one. */
  const baseView = (): PlotView | null => {
    const view = target ?? (inFlight > 0 ? sent : null) ?? readPlotView(root, handle.dim);
    return view && view.dim === handle.dim ? view : null;
  };

  /** Eases from what shows now to `next(where the current step ends)`, so repeated presses add up. */
  const easeTo = (next: (from: PlotView) => PlotView): void => {
    const end = animation?.to ?? baseView();
    if (!end) return;
    const from = animation?.shown ?? end;
    target = null;
    animation = { from, to: next(end), start: now(), shown: from };
    schedule();
  };

  /** The view a wheel event moves: the end of a running eased step, which the wheel takes over. */
  const wheelBase = (): PlotView | null => {
    const end = animation?.to ?? null;
    animation = null;
    return end ?? baseView();
  };

  const applyMode = (next: PlotDragMode): void => {
    mode = next;
    if (next === "turntable" || next === "orbit") rotateMode = next;
    handle.setDragMode(next).catch(() => undefined);
    changed();
  };

  const showHint = (): void => {
    if (hintShown || readPlotView(root, handle.dim) === null) return;
    hintShown = true;
    const zoomKey = isMac(doc) ? "⌘" : "Ctrl";
    hint = renderElement("div", { class: "qmd-plot-hint", "aria-hidden": "true" }, `Pinch or ${zoomKey}-scroll to zoom · click to pan with scroll`);
    root.append(hint);
    requestFrame(() => hint?.classList.add("is-shown"));
    hintTimer = win.setTimeout(() => hint?.classList.remove("is-shown"), HINT_MS);
  };

  const onWheel = (event: WheelEvent): void => {
    const zoomGesture = event.ctrlKey || event.metaKey;
    if (!zoomGesture && !active) {
      showHint();
      return;
    }
    const start = wheelBase();
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = root.getBoundingClientRect();
    const { dx, dy } = wheelPx(event, rect.height || 400);
    if (start.dim === 2 && !zoomGesture && !event.shiftKey) {
      const area = readPlotArea(root);
      if (!area) return;
      target = panPlotView(start, dx / area.width, -dy / area.height);
      schedule();
      return;
    }
    // Shift turns a vertical wheel into a horizontal one on some systems.
    const amount = dy !== 0 ? dy : dx;
    const rate = zoomGesture && Math.abs(amount) < PINCH_DELTA ? PINCH_RATE : WHEEL_RATE;
    const factor = Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, Math.exp(amount * rate)));
    const area = start.dim === 2 ? readPlotArea(root) : null;
    const anchor = area ? plotPointAt(start, area, event.clientX - rect.left, event.clientY - rect.top) : null;
    target = zoomPlotView(start, factor, anchor);
    schedule();
  };

  const nav: PlotNavigation = {
    get mode() { return mode; },
    get active() { return active; },
    zoom(direction: PlotZoomDirection): void {
      const step = handle.dim === 3 ? STEP_ZOOM_3D : STEP_ZOOM_2D;
      const factor = direction === "in" ? step : 1 / step;
      easeTo((from) => zoomPlotView(from, factor));
    },
    resetView(): void {
      if (handle.dim === 3) {
        easeTo(() => DEFAULT_PLOT_VIEW_3D);
        return;
      }
      animation = null;
      target = null;
      handle.resetView().catch(() => undefined);
    },
    autoscale(): void {
      animation = null;
      target = null;
      handle.autoscale().catch(() => undefined);
    },
    setMode(next: PlotDragMode): void {
      applyMode(next);
    },
    toggleAlternate(): void {
      if (handle.dim === 3) applyMode(mode === "orbit" ? "turntable" : "orbit");
      else applyMode(mode === "zoom" ? "pan" : "zoom");
    },
    togglePan(): void {
      if (handle.dim === 3) applyMode(mode === "pan" ? rotateMode : "pan");
      else applyMode("pan");
    },
    toggleSurfaceStyle(): void {
      if (!handle.hasSurfaces) return;
      const at = PLOT_SURFACE_STYLES.indexOf(handle.surfaceStyle);
      const next = handle.wireframeFits ? PLOT_SURFACE_STYLES[(at + 1) % PLOT_SURFACE_STYLES.length]! : "surface";
      if (next === handle.surfaceStyle) return;
      handle.setSurfaceStyle(next).catch(() => undefined);
      changed();
    },
    toggleSurfaceColour(): void {
      if (!handle.hasSurfaces) return;
      handle.setSurfaceColour(handle.surfaceColour === "height" ? "single" : "height").catch(() => undefined);
      changed();
    },
    syncDim(): void {
      if (handle.dim === shownDim) return;
      shownDim = handle.dim;
      animation = null;
      target = null;
      mode = defaultDragMode(shownDim);
      rotateMode = "turntable";
      changed();
    },
    destroy(): void {
      destroyed = true;
      win.clearTimeout(hintTimer);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("focus", onFocus);
      root.removeEventListener("blur", onBlur);
      options.zone.removeEventListener("pointerleave", onLeave);
      doc.removeEventListener("pointerdown", onOutside, true);
    },
  };

  const pan = (fx: number, fy: number): void => easeTo((from) => panPlotView(from, fx, fy));
  const turn = (azimuth: number, elevation: number): void => easeTo((from) => rotatePlotView(from, azimuth, elevation));

  /** Runs the plot's shortcut for `event`, or returns false when the key is not one. */
  const runKey = (event: KeyboardEvent): boolean => {
    const three = handle.dim === 3;
    const step = event.shiftKey ? (three ? TURN_STEP_LARGE : PAN_STEP_LARGE) : (three ? TURN_STEP : PAN_STEP);
    switch (event.key) {
      case "ArrowLeft": if (three) turn(-step, 0); else pan(-step, 0); return true;
      case "ArrowRight": if (three) turn(step, 0); else pan(step, 0); return true;
      case "ArrowUp": if (three) turn(0, step); else pan(0, step); return true;
      case "ArrowDown": if (three) turn(0, -step); else pan(0, -step); return true;
      case "+": case "=": nav.zoom("in"); return true;
      case "-": case "_": case "−": nav.zoom("out"); return true;
      case "0": case "r": case "R": nav.resetView(); return true;
      case "b": case "B": if (three) return false; nav.toggleAlternate(); return true;
      case "o": case "O": if (!three) return false; nav.toggleAlternate(); return true;
      case "a": case "A": if (three) return false; nav.autoscale(); return true;
      case "p": case "P": nav.togglePan(); return true;
      case "w": case "W": if (!handle.hasSurfaces) return false; nav.toggleSurfaceStyle(); return true;
      case "h": case "H": if (!handle.hasSurfaces) return false; nav.toggleSurfaceColour(); return true;
      case "Escape":
        // The overlay's Escape closes it.
        if (always) return false;
        setActive(false);
        root.blur();
        return true;
      default: return false;
    }
  };

  function onKey(event: KeyboardEvent): void {
    if (event.target !== root || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!runKey(event)) return;
    // The note editor and the host's keybindings must not act on a key the plot took.
    event.preventDefault();
    event.stopPropagation();
  }

  function onDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    nav.resetView();
  }

  /** Set while the root holds a focus a press gave it, which shows no ring: a programmatic focus after the editor's can still match :focus-visible. */
  function onPointerDown(): void {
    setActive(true);
    root.classList.add("is-pointer-focus");
    if (doc.activeElement !== root) root.focus({ preventScroll: true });
  }

  function onFocus(): void { setActive(true); }
  function onBlur(): void { root.classList.remove("is-pointer-focus"); }
  function onLeave(): void { setActive(false); }
  function onOutside(event: Event): void {
    if (!options.zone.contains(event.target as Node | null)) setActive(false);
  }

  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("keydown", onKey);
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("focus", onFocus);
  root.addEventListener("blur", onBlur);
  options.zone.addEventListener("pointerleave", onLeave);
  doc.addEventListener("pointerdown", onOutside, true);
  setActive(always);
  return nav;
}
