// Shows the build logs' severity tabs with their counts.
import type { PreviewProblem } from "../../index.js";
import { TabList } from "../chrome/index.js";

/** Which problems a logs tab lists. */
export type LogsFilter = "all" | PreviewProblem["severity"];

const TABS: ReadonlyArray<{ id: LogsFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors" },
  { id: "warning", label: "Warnings" },
  { id: "info", label: "Info" },
];

/** @returns true when `problem` belongs on the tab of `filter`. */
export const matchesFilter = (problem: PreviewProblem, filter: LogsFilter): boolean =>
  filter === "all" || problem.severity === filter;

export class LogsTabs {
  private readonly tabs: TabList<LogsFilter>;

  constructor(onSelect: (filter: LogsFilter) => void) {
    this.tabs = new TabList(TABS, { label: "Problem severity", onSelect });
    this.tabs.el.classList.add("rd-logs-tabs");
  }

  get el(): HTMLElement { return this.tabs.el; }

  get filter(): LogsFilter { return this.tabs.selected; }

  /** Writes each tab's count of `problems`; a tab with none stays, muted. */
  setCounts(problems: PreviewProblem[]): void {
    for (const { id, label } of TABS) {
      const n = problems.filter((p) => matchesFilter(p, id)).length;
      const button = this.tabs.button(id);
      button.textContent = `${label} ${n}`;
      button.classList.toggle("rd-logs-tab-empty", n === 0);
    }
  }

  /** Selects the tab of `filter` and tells the view to list its problems. */
  select(filter: LogsFilter, focus = false): void { this.tabs.select(filter, focus); }
}
