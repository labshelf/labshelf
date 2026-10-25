// Shows the cite count and the problems left in the shown PDF, and steps through them with prev/next chevrons.
import { renderIcon } from "../../../../ui/index.js";
import { renderElement, showToast } from "../../../../ui/dom/index.js";
import type { PageArea, PdfProblem, PreviewBuildRoots, WebviewToHost } from "../../../index.js";

interface ProblemsDeps {
  /** The reader's problem marks; `index` counts into the shown root's `pdfProblems`. */
  marks: { flash(index: number): void };
  scrollTo(area: PageArea): void;
  post: (msg: WebviewToHost) => void;
}

export interface PreviewProblems {
  setRoots(roots: PreviewBuildRoots): void;
  /** Moves to the next (1) or previous (-1) problem, wrapping at the ends. */
  step(dir: 1 | -1): void;
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function arrow(label: string, glyph: "chevron-left" | "chevron-right", onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "rd-preview-problem-step", type: "button", title: label, "aria-label": label, html: renderIcon(glyph) });
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
    showToast(problem.message);
    if (problem.file !== undefined && problem.line !== undefined) {
      post({ command: "openSourceLine", file: problem.file, line: problem.line });
    }
  }

  function step(dir: 1 | -1): void {
    if (problems.length === 0) {
      showToast("No problems in the PDF");
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
      const status = renderElement("span", { class: "rd-preview-cites", role: "status", "aria-live": "polite" }, plural(cites ?? 0, "cite"));
      if (problems.length > 0) {
        const tone = problems.some((p) => p.kind === "undefinedCitation") ? "error" : "warning";
        status.append(" · ", renderElement("span", { class: "rd-preview-to-fix", "data-tone": tone }, `${problems.length} to fix`));
      }
      slot.replaceChildren(status);
      if (problems.length > 0) {
        slot.append(arrow("Previous problem", "chevron-left", () => step(-1)), arrow("Next problem", "chevron-right", () => step(1)));
      }
    },
  };
}
