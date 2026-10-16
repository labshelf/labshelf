// Shows the cite count and the problems left in the shown PDF, and steps through them with prev/next arrows.
import { icon } from "../../../../../ui/index.js";
import { el, toast } from "../../../../../ui/dom/index.js";
import type { PageArea, PdfProblem, PreviewRoots, WebviewToHost } from "../../../../index.js";

interface ProblemsDeps {
  /** The reader's problem marks; `index` counts into the shown root's `pdfProblems`. */
  marks: { flash(index: number): void };
  scrollTo(area: PageArea): void;
  post: (msg: WebviewToHost) => void;
}

export interface PreviewProblems {
  setRoots(roots: PreviewRoots): void;
  /** Moves to the next (1) or previous (-1) problem, wrapping at the ends. */
  step(dir: 1 | -1): void;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function arrow(label: string, glyph: "arrow-left" | "arrow-right", onClick: () => void): HTMLButtonElement {
  const button = el("button", { class: "rd-preview-problem-step", type: "button", title: label, "aria-label": label, html: icon(glyph) });
  button.addEventListener("click", onClick);
  return button;
}

/** Fills the footer's cites slot; the caller owns the slot element and feeds it the roots. */
export function mountProblems(slot: HTMLElement, { marks, scrollTo, post }: ProblemsDeps): PreviewProblems {
  let problems: PdfProblem[] = [];
  // Index of the problem last shown; -1 before the first step, so next lands on 0 and previous on the last.
  let at = -1;

  function reveal(problem: PdfProblem, index: number): void {
    if (problem.area) {
      scrollTo(problem.area);
      marks.flash(index);
      return;
    }
    toast(problem.message);
    if (problem.file !== undefined && problem.line !== undefined) {
      post({ command: "openSourceLine", file: problem.file, line: problem.line });
    }
  }

  function step(dir: 1 | -1): void {
    if (problems.length === 0) {
      toast("No problems in the PDF");
      return;
    }
    at = at === -1 && dir === -1 ? problems.length - 1 : (at + dir + problems.length) % problems.length;
    reveal(problems[at]!, at);
  }

  return {
    step,
    setRoots(roots) {
      const shown = roots.roots.find((r) => r.path === roots.shown);
      problems = shown?.pdfProblems ?? [];
      at = -1;
      const cites = shown?.cites;
      slot.hidden = cites === undefined && problems.length === 0;
      const text = `${plural(cites ?? 0, "cite")}${problems.length > 0 ? ` · ${problems.length} to fix` : ""}`;
      const status = el("span", { class: "rd-preview-cites", role: "status", "aria-live": "polite" }, text);
      slot.replaceChildren(status);
      if (problems.length > 0) {
        slot.append(arrow("Previous problem", "arrow-left", () => step(-1)), arrow("Next problem", "arrow-right", () => step(1)));
      }
    },
  };
}
