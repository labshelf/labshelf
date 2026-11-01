// Moves a drawn interactive plot with the trackpad, mouse wheel and keyboard: pinch and Ctrl/Cmd+wheel zoom about the
// cursor, a two-finger scroll pans while the plot is active, arrows pan or rotate, and button zooms ease in over a few frames.
import type { PlotHandle } from "./plotRender.js";
import { PLOT_SURFACE_STYLES } from "./plotView.js";
import { ViewDriver } from "./plotViewDriver.js";
import { defaultDragMode, DEFAULT_PLOT_VIEW_3D, panPlotView, rotatePlotView, zoomPlotView, type PlotDragMode, type PlotZoomDirection } from "./plotViewState.js";
import { PlotWheel } from "./plotWheel.js";

/** An arrow key pans by this share of the span, with Shift the larger one; in 3D it turns the camera by the angle. */
const PAN_STEP = 0.1;
const PAN_STEP_LARGE = 0.5;
const TURN_STEP = Math.PI / 24;
const TURN_STEP_LARGE = Math.PI / 6;

/** What a shortcut can ask of the plot's navigation. */
interface PlotKeyActions {
  zoom(direction: "in" | "out"): void;
  resetView(): void;
  autoscale(): void;
  toggleAlternate(): void;
  togglePan(): void;
  toggleSurfaceStyle(): void;
  toggleSurfaceColour(): void;
}

interface PlotKeyContext {
  readonly actions: PlotKeyActions;
  readonly handle: PlotHandle;
  readonly driver: ViewDriver;
  /** True for the expanded overlay's plot, whose Escape closes the overlay instead. */
  readonly always: boolean;
  /** Puts the plot to sleep again and takes the focus off it. */
  sleep(): void;
}

/** Runs the plot's shortcut for `event`, or returns false when the key is not one. */
function runPlotKey(event: KeyboardEvent, context: PlotKeyContext): boolean {
  const { actions, handle, driver } = context;
  const three = handle.dim === 3;
  const step = event.shiftKey ? (three ? TURN_STEP_LARGE : PAN_STEP_LARGE) : (three ? TURN_STEP : PAN_STEP);
  const pan = (fx: number, fy: number): void => driver.easeTo((from) => panPlotView(from, fx, fy));
  const turn = (azimuth: number, elevation: number): void => driver.easeTo((from) => rotatePlotView(from, azimuth, elevation));
  switch (event.key) {
    case "ArrowLeft": if (three) turn(-step, 0); else pan(-step, 0); return true;
    case "ArrowRight": if (three) turn(step, 0); else pan(step, 0); return true;
    case "ArrowUp": if (three) turn(0, step); else pan(0, step); return true;
    case "ArrowDown": if (three) turn(0, -step); else pan(0, -step); return true;
    case "+": case "=": actions.zoom("in"); return true;
    case "-": case "_": case "−": actions.zoom("out"); return true;
    case "0": case "r": case "R": actions.resetView(); return true;
    case "b": case "B": if (three) return false; actions.toggleAlternate(); return true;
    case "o": case "O": if (!three) return false; actions.toggleAlternate(); return true;
    case "a": case "A": if (three) return false; actions.autoscale(); return true;
    case "p": case "P": actions.togglePan(); return true;
    case "w": case "W": if (!handle.hasSurfaces) return false; actions.toggleSurfaceStyle(); return true;
    case "h": case "H": if (!handle.hasSurfaces) return false; actions.toggleSurfaceColour(); return true;
    case "Escape":
      // The overlay's Escape closes it.
      if (context.always) return false;
      context.sleep();
      return true;
    default: return false;
  }
}

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

/** The state and handlers of one plot's navigation. */
class Navigator implements PlotNavigation {
  mode: PlotDragMode;
  active = false;
  private rotateMode: PlotDragMode;
  private shownDim: 2 | 3;
  private readonly always: boolean;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly driver: ViewDriver;
  private readonly wheel: PlotWheel;

  constructor(private readonly root: HTMLElement, private readonly handle: PlotHandle, private readonly options: PlotNavigationOptions) {
    this.doc = root.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    this.always = options.alwaysActive === true;
    this.mode = defaultDragMode(handle.dim);
    this.rotateMode = this.mode === "orbit" ? "orbit" : "turntable";
    this.shownDim = handle.dim;
    this.driver = new ViewDriver(root, handle, this.win);
    this.wheel = new PlotWheel(root, handle, this.win, this.driver, () => this.active);
    this.listen();
    this.setActive(this.always);
  }

  zoom(direction: PlotZoomDirection): void {
    const step = this.handle.dim === 3 ? STEP_ZOOM_3D : STEP_ZOOM_2D;
    const factor = direction === "in" ? step : 1 / step;
    this.driver.easeTo((from) => zoomPlotView(from, factor));
  }

  resetView(): void {
    if (this.handle.dim === 3) {
      this.driver.easeTo(() => DEFAULT_PLOT_VIEW_3D);
      return;
    }
    this.driver.stop();
    this.handle.resetView().catch(() => undefined);
  }

  autoscale(): void {
    this.driver.stop();
    this.handle.autoscale().catch(() => undefined);
  }

  setMode(next: PlotDragMode): void {
    this.mode = next;
    if (next === "turntable" || next === "orbit") this.rotateMode = next;
    this.handle.setDragMode(next).catch(() => undefined);
    this.changed();
  }

  toggleAlternate(): void {
    if (this.handle.dim === 3) this.setMode(this.mode === "orbit" ? "turntable" : "orbit");
    else this.setMode(this.mode === "zoom" ? "pan" : "zoom");
  }

  togglePan(): void {
    if (this.handle.dim === 3) this.setMode(this.mode === "pan" ? this.rotateMode : "pan");
    else this.setMode("pan");
  }

  toggleSurfaceStyle(): void {
    const handle = this.handle;
    if (!handle.hasSurfaces) return;
    const at = PLOT_SURFACE_STYLES.indexOf(handle.surfaceStyle);
    const next = handle.wireframeFits ? PLOT_SURFACE_STYLES[(at + 1) % PLOT_SURFACE_STYLES.length]! : "surface";
    if (next === handle.surfaceStyle) return;
    handle.setSurfaceStyle(next).catch(() => undefined);
    this.changed();
  }

  toggleSurfaceColour(): void {
    if (!this.handle.hasSurfaces) return;
    this.handle.setSurfaceColour(this.handle.surfaceColour === "height" ? "single" : "height").catch(() => undefined);
    this.changed();
  }

  syncDim(): void {
    if (this.handle.dim === this.shownDim) return;
    this.shownDim = this.handle.dim;
    this.driver.stop();
    this.mode = defaultDragMode(this.shownDim);
    this.rotateMode = "turntable";
    this.changed();
  }

  destroy(): void {
    this.driver.destroy();
    this.wheel.destroy();
    this.root.removeEventListener("wheel", this.wheel.onWheel);
    this.root.removeEventListener("keydown", this.onKey);
    this.root.removeEventListener("dblclick", this.onDoubleClick);
    this.root.removeEventListener("pointerdown", this.onPointerDown, true);
    this.root.removeEventListener("focus", this.onFocus);
    this.root.removeEventListener("blur", this.onBlur);
    this.options.zone.removeEventListener("pointerleave", this.onLeave);
    this.doc.removeEventListener("pointerdown", this.onOutside, true);
  }

  private changed(): void { this.options.onChange?.(); }

  private setActive(next: boolean): void {
    const value = this.always || next;
    if (value === this.active) return;
    this.active = value;
    this.root.classList.toggle("is-active", value);
    this.changed();
  }

  private listen(): void {
    const root = this.root;
    root.addEventListener("wheel", this.wheel.onWheel, { passive: false });
    root.addEventListener("keydown", this.onKey);
    root.addEventListener("dblclick", this.onDoubleClick);
    root.addEventListener("pointerdown", this.onPointerDown, true);
    root.addEventListener("focus", this.onFocus);
    root.addEventListener("blur", this.onBlur);
    this.options.zone.addEventListener("pointerleave", this.onLeave);
    this.doc.addEventListener("pointerdown", this.onOutside, true);
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.target !== this.root || event.ctrlKey || event.metaKey || event.altKey) return;
    const ran = runPlotKey(event, {
      actions: this, handle: this.handle, driver: this.driver, always: this.always,
      sleep: () => { this.setActive(false); this.root.blur(); },
    });
    if (!ran) return;
    // The note editor and the host's keybindings must not act on a key the plot took.
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    event.preventDefault();
    this.resetView();
  };

  /** Set while the root holds a focus a press gave it, which shows no ring: a programmatic focus after the editor's can still match :focus-visible. */
  private readonly onPointerDown = (): void => {
    this.setActive(true);
    this.root.classList.add("is-pointer-focus");
    if (this.doc.activeElement !== this.root) this.root.focus({ preventScroll: true });
  };

  private readonly onFocus = (): void => { this.setActive(true); };
  private readonly onBlur = (): void => { this.root.classList.remove("is-pointer-focus"); };
  private readonly onLeave = (): void => { this.setActive(false); };
  private readonly onOutside = (event: Event): void => {
    if (!this.options.zone.contains(event.target as Node | null)) this.setActive(false);
  };
}

export function attachPlotNavigation(root: HTMLElement, handle: PlotHandle, options: PlotNavigationOptions): PlotNavigation {
  return new Navigator(root, handle, options);
}
