// Lists a build root's problems for one logs tab; an entry that names a source place opens it.
import { el } from "../../../../ui/dom/index.js";
import { icon, type IconName } from "../../../../ui/index.js";
import type { PreviewProblem } from "../../../index.js";
import { fileName } from "../fileName.js";
import { matchesFilter, type LogsFilter } from "./logsTabs.js";

const SEVERITY_ICON: Record<PreviewProblem["severity"], IconName> = { error: "warning", warning: "warning", info: "info" };

function location(problem: PreviewProblem): string {
  return problem.line === undefined ? fileName(problem.file!) : `${fileName(problem.file!)}:${problem.line}`;
}

function entryBody(problem: PreviewProblem): Array<HTMLElement | null> {
  return [
    el("span", { class: `rd-log-icon rd-log-${problem.severity}`, "aria-hidden": "true", html: icon(SEVERITY_ICON[problem.severity]) }),
    el("span", { class: "rd-log-text" },
      el("span", { class: "rd-log-message", text: problem.message }),
      problem.hint ? el("span", { class: "rd-log-hint", text: problem.hint }) : null,
    ),
    problem.file ? el("span", { class: "rd-log-location", text: location(problem) }) : null,
  ];
}

/**
 * Fills `body` with the problems `filter` keeps, or "No problems".
 * @param open receives the index of the clicked problem in the full `problems` list.
 */
export function renderEntries(
  body: HTMLElement, problems: PreviewProblem[], filter: LogsFilter, open: (index: number) => void,
): void {
  const items = problems.flatMap((problem, index) => {
    if (!matchesFilter(problem, filter)) { return []; }
    if (!problem.file) { return [el("li", {}, el("div", { class: "rd-log-entry" }, ...entryBody(problem)))]; }
    const button = el("button", { class: "rd-log-entry", type: "button", title: `Open ${problem.file}` }, ...entryBody(problem));
    button.addEventListener("click", () => open(index));
    return [el("li", {}, button)];
  });
  body.replaceChildren(items.length > 0
    ? el("ul", { class: "rd-log-list", "aria-label": "Problems" }, ...items)
    : el("div", { class: "rd-empty", text: "No problems" }));
}
