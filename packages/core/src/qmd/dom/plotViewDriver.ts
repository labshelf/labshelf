// Drives the view of a drawn plot for its navigation: coalesces the views events ask for into one relayout per frame and eases
// button and key steps over a few frames, so repeated presses add up.
import type { PlotHandle } from "./plotRender.js";
import { blendPlotView, plotViewUpdate, readPlotView, type PlotView } from "./plotViewState.js";

/** How long an eased step takes. */
const STEP_MS = 150;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** The window's clock in ms, falling back to the date where it has no performance timer. */
function nowOf(win: Window): number {
  return win.performance?.now() ?? Date.now();
}

/** Runs `run` on the window's next frame, or in 16 ms where it has no animation frames. */
export function requestFrameOf(win: Window, run: (time: number) => void): void {
  if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(run);
  else win.setTimeout(() => run(nowOf(win)), 16);
}

interface Animation { from: PlotView; to: PlotView; start: number; shown: PlotView }

export class ViewDriver {
  /** The view the next frame shows, coalescing every event since the last one. */
  private target: PlotView | null = null;
  private animation: Animation | null = null;
  private framePending = false;
  /** The last view handed to Plotly and how many of those relayouts are still running. */
  private sent: PlotView | null = null;
  private inFlight = 0;
  private destroyed = false;

  constructor(private readonly root: HTMLElement, private readonly handle: PlotHandle, private readonly win: Window) {}

  /** Asks for `view` on the next frame. */
  setTarget(view: PlotView): void {
    this.target = view;
    this.schedule();
  }

  /** Drops the queued view and any eased step. */
  stop(): void {
    this.animation = null;
    this.target = null;
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Eases from what shows now to `next(where the current step ends)`, so repeated presses add up. */
  easeTo(next: (from: PlotView) => PlotView): void {
    const end = this.animation?.to ?? this.baseView();
    if (!end) return;
    const from = this.animation?.shown ?? end;
    this.target = null;
    this.animation = { from, to: next(end), start: nowOf(this.win), shown: from };
    this.schedule();
  }

  /** The view a wheel event moves: the end of a running eased step, which the wheel takes over. */
  wheelBase(): PlotView | null {
    const end = this.animation?.to ?? null;
    this.animation = null;
    return end ?? this.baseView();
  }

  /** The view a new gesture starts from: the queued one, else the last sent while Plotly applies it, else the drawn one. */
  private baseView(): PlotView | null {
    const view = this.target ?? (this.inFlight > 0 ? this.sent : null) ?? readPlotView(this.root, this.handle.dim);
    return view && view.dim === this.handle.dim ? view : null;
  }

  private send(view: PlotView): void {
    this.sent = view;
    this.inFlight++;
    this.handle.relayout(plotViewUpdate(view)).catch(() => undefined).finally(() => { this.inFlight--; });
  }

  private schedule(): void {
    if (this.framePending || this.destroyed) return;
    this.framePending = true;
    requestFrameOf(this.win, this.tick);
  }

  private readonly tick = (time: number): void => {
    this.framePending = false;
    if (this.destroyed) return;
    if (this.animation) {
      const t = Math.min(1, Math.max(0, (time - this.animation.start) / STEP_MS));
      const view = t >= 1 ? this.animation.to : blendPlotView(this.animation.from, this.animation.to, easeOut(t));
      this.animation.shown = view;
      if (t >= 1) this.animation = null;
      else this.schedule();
      this.send(view);
      return;
    }
    if (this.target) {
      const view = this.target;
      this.target = null;
      this.send(view);
    }
  };
}
