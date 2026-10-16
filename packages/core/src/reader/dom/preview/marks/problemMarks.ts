// Marks each placed PDF problem over its area on its page and flashes one on request.
import type { PageArea, PdfProblem } from "../../../index.js";
import { pixelOffsetOf, type PageViewportLike } from "../../navigation/index.js";
import type { ReaderContext } from "../../session/index.js";

export interface ProblemMarks {
  /** Replaces the marked problems; only those with an `area` get a mark. */
  setProblems(problems: readonly PdfProblem[]): void;
  /** Flashes the mark of the problem at `index` of the last `setProblems` list; an unplaced or unknown index does nothing. */
  flash(index: number): void;
}

interface PageViewLike {
  div: HTMLElement;
  viewport: PageViewportLike & { width: number; height: number };
}

const LAYER_CLASS = "rd-problem-marks";
const MARK_CLASS = "rd-problem-mark";
const FLASH_CLASS = "rd-problem-mark--flash";
const FLASH_MS = 1400;

export function mountProblemMarks(deps: { container: HTMLElement; pdfViewer: ReaderContext["pdfViewer"] }): ProblemMarks {
  const { container, pdfViewer } = deps;
  let problems: readonly PdfProblem[] = [];
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const drawPage = (page: number): void => {
    const view = pdfViewer.getPageView(page - 1) as PageViewLike | undefined;
    if (!view?.viewport) { return; }
    for (const old of view.div.querySelectorAll(`.${LAYER_CLASS}`)) { old.remove(); }
    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    problems.forEach((problem, index) => {
      if (problem.area?.page === page) { layer.appendChild(markFor(view.viewport, problem, index)); }
    });
    if (layer.childElementCount > 0) { view.div.appendChild(layer); }
  };
  const drawAll = (): void => {
    for (let page = 1; page <= pdfViewer.pagesCount; page++) { drawPage(page); }
  };

  // PLATFORM: pdf.js empties a page's element when it re-renders it, which drops the layer.
  pdfViewer.eventBus.on("pagerendered", ({ pageNumber }: { pageNumber: number }) => drawPage(pageNumber));
  pdfViewer.eventBus.on("scalechanging", drawAll);

  return {
    setProblems(next) {
      problems = next;
      drawAll();
    },
    flash(index) {
      const marks = container.querySelectorAll<HTMLElement>(`.${MARK_CLASS}[data-problem-index="${index}"]`);
      if (marks.length === 0) { return; }
      clearTimeout(flashTimer);
      for (const stale of container.querySelectorAll(`.${FLASH_CLASS}`)) { stale.classList.remove(FLASH_CLASS); }
      for (const mark of marks) { mark.classList.add(FLASH_CLASS); }
      flashTimer = setTimeout(() => { for (const mark of marks) { mark.classList.remove(FLASH_CLASS); } }, FLASH_MS);
    },
  };
}

/** Positioned in percent of the page, so the mark keeps its place while pdf.js scales the page before re-rendering it. */
function markFor(viewport: PageViewLike["viewport"], problem: PdfProblem, index: number): HTMLElement {
  const area = problem.area as PageArea;
  const [x1, y1] = pixelOffsetOf(viewport, { page: area.page, x: area.left, y: area.top });
  const [x2, y2] = pixelOffsetOf(viewport, { page: area.page, x: area.right, y: area.bottom });
  const mark = document.createElement("div");
  mark.className = `${MARK_CLASS} ${MARK_CLASS}--${problem.kind}`;
  mark.dataset.problemIndex = String(index);
  mark.setAttribute("aria-hidden", "true");
  const overfull = problem.kind === "overfull";
  // The margin bar sits just right of the area; its width comes from CSS.
  mark.style.left = `${((overfull ? Math.max(x1, x2) : Math.min(x1, x2)) / viewport.width) * 100}%`;
  mark.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
  if (!overfull) { mark.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`; }
  mark.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
  return mark;
}
