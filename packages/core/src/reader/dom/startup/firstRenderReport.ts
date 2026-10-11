/**
 * Posts the open timeline to the host once the first page is on screen, so slow opens can be diagnosed from app.log without DevTools.
 */
import type { ThemeController } from "../chrome/index.js";
import type { PerfMarks, ReaderContext } from "../session/index.js";
import type { DeferredHover } from "./deferredHover.js";

interface PageRenderedEvent {
  source?: { canvas?: HTMLCanvasElement };
  pageNumber: number;
}

/**
 * Reports the first `pagerendered` once, then lets the hover preview build itself.
 * @returns void
 */
export function reportFirstRender(ctx: ReaderContext, theme: ThemeController, perf: PerfMarks, hover: DeferredHover): void {
  let reported = false;
  ctx.eventBus.on("pagerendered", ({ source, pageNumber }: PageRenderedEvent) => {
    if (reported) { return; }
    reported = true;
    perf.mark("firstPageRendered");
    const cv = source?.canvas;
    ctx.host.post({
      command: "perf",
      timeline: perf.timeline,
      pageNumber,
      theme: theme.effective,
      dpr: window.devicePixelRatio,
      canvas: cv ? `${cv.width}x${cv.height}` : null,
    });
    hover.createWhenIdle();
  });
}
