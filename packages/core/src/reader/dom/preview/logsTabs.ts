// Shows the build logs' severity tabs with their counts; arrow keys move the selection with a roving tabindex.
import { el } from "../../../ui/dom/index.js";
import type { PreviewProblem } from "../../index.js";

/** Which problems a logs tab lists. */
export type LogsFilter = "all" | PreviewProblem["severity"];

const TABS: ReadonlyArray<{ filter: LogsFilter; label: string }> = [
  { filter: "all", label: "All" },
  { filter: "error", label: "Errors" },
  { filter: "warning", label: "Warnings" },
  { filter: "info", label: "Info" },
];

/** @returns true when `problem` belongs on the tab of `filter`. */
export const matchesFilter = (problem: PreviewProblem, filter: LogsFilter): boolean =>
  filter === "all" || problem.severity === filter;

export class LogsTabs {
  readonly el = el("div", { class: "rd-tabs rd-logs-tabs", role: "tablist", "aria-label": "Problem severity" });
  private readonly buttons: HTMLButtonElement[];
  private selected: LogsFilter = "all";

  constructor(private readonly onSelect: (filter: LogsFilter) => void) {
    this.buttons = TABS.map(({ filter }) => {
      const button = el("button", { class: "rd-tab", type: "button", role: "tab" });
      button.addEventListener("click", () => this.select(filter));
      return button;
    });
    this.el.append(...this.buttons);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.mark();
  }

  get filter(): LogsFilter { return this.selected; }

  /** Writes each tab's count of `problems`; a tab with none stays, muted. */
  setCounts(problems: PreviewProblem[]): void {
    TABS.forEach(({ filter, label }, i) => {
      const n = problems.filter((p) => matchesFilter(p, filter)).length;
      const button = this.buttons[i]!;
      button.textContent = `${label} ${n}`;
      button.classList.toggle("rd-logs-tab-empty", n === 0);
    });
  }

  /** Selects the tab of `filter` and tells the view to list its problems. */
  select(filter: LogsFilter, focus = false): void {
    this.selected = filter;
    this.mark();
    if (focus) { this.buttons[this.index()]!.focus(); }
    this.onSelect(filter);
  }

  private index(): number { return TABS.findIndex((t) => t.filter === this.selected); }

  private mark(): void {
    const current = this.index();
    this.buttons.forEach((button, i) => {
      button.setAttribute("aria-selected", String(i === current));
      button.tabIndex = i === current ? 0 : -1;
    });
  }

  private onKey(e: KeyboardEvent): void {
    const last = TABS.length - 1;
    const step: Record<string, number> = { ArrowRight: this.index() + 1, ArrowLeft: this.index() - 1, Home: 0, End: last };
    const target = step[e.key];
    if (target === undefined) { return; }
    e.preventDefault();
    const wrapped = target < 0 ? last : target > last ? 0 : target;
    this.select(TABS[wrapped]!.filter, true);
  }
}
