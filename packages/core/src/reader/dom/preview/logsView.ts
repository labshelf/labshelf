// Shows a build root's problems over the page area, by severity tab, with its raw log one click away.
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../../ui/index.js";
import type { PreviewBuildRoot, PreviewBuildRoots, WebviewToHost, PreviewProblem } from "../../index.js";
import { renderReaderIconButton } from "../elements/index.js";
import { deriveFileName } from "./deriveFileName.js";
import { TabList } from "../chrome/index.js";

/** Which problems a logs tab lists. */
type LogsFilter = "all" | PreviewProblem["severity"];

const TABS: ReadonlyArray<{ id: LogsFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors" },
  { id: "warning", label: "Warnings" },
  { id: "info", label: "Info" },
];

/** @returns true when `problem` belongs on the tab of `filter`. */
const matchesFilter = (problem: PreviewProblem, filter: LogsFilter): boolean =>
  filter === "all" || problem.severity === filter;

class LogsTabs {
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

const SEVERITY_ICON: Record<PreviewProblem["severity"], IconName> = { error: "warning", warning: "warning", info: "info" };

function location(problem: PreviewProblem): string {
  return problem.line === undefined ? deriveFileName(problem.file!) : `${deriveFileName(problem.file!)}:${problem.line}`;
}

function entryBody(problem: PreviewProblem): Array<HTMLElement | null> {
  return [
    renderElement("span", { class: `rd-log-icon rd-log-${problem.severity}`, "aria-hidden": "true", html: renderIcon(SEVERITY_ICON[problem.severity]) }),
    renderElement("span", { class: "rd-log-text" },
      renderElement("span", { class: "rd-log-message", text: problem.message }),
      problem.hint ? renderElement("span", { class: "rd-log-hint", text: problem.hint }) : null,
    ),
    problem.file ? renderElement("span", { class: "rd-log-location", text: location(problem) }) : null,
  ];
}

/**
 * Fills `body` with the problems `filter` keeps, or "No problems".
 * @param open receives the index of the clicked problem in the full `problems` list.
 */
function renderEntries(
  body: HTMLElement, problems: PreviewProblem[], filter: LogsFilter, open: (index: number) => void,
): void {
  const items = problems.flatMap((problem, index) => {
    if (!matchesFilter(problem, filter)) { return []; }
    if (!problem.file) { return [renderElement("li", {}, renderElement("div", { class: "rd-log-entry" }, ...entryBody(problem)))]; }
    const button = renderElement("button", { class: "rd-log-entry", type: "button", title: `Open ${problem.file}` }, ...entryBody(problem));
    button.addEventListener("click", () => open(index));
    return [renderElement("li", {}, button)];
  });
  body.replaceChildren(items.length > 0
    ? renderElement("ul", { class: "rd-log-list", "aria-label": "Problems" }, ...items)
    : renderElement("div", { class: "rd-empty", text: "No problems" }));
}

interface LogsViewDeps {
  /** The element the pane covers: the page area, beside the sidebar. */
  parent: HTMLElement;
  post: (msg: WebviewToHost) => void;
}

export class LogsView {
  private readonly pane = renderElement("section", { class: "rd-logs", role: "region", "aria-label": "Build logs", hidden: true });
  private readonly title = renderElement("span", { class: "rd-logs-title" });
  private readonly rawLog = renderReaderIconButton(renderIcon("file-text"), "Open raw log");
  private readonly header: HTMLElement;
  private readonly body = renderElement("div", { class: "rd-logs-body" });
  private readonly tabs = new LogsTabs(() => this.renderEntries());
  private roots: PreviewBuildRoots | null = null;
  private rootPath: string | null = null;

  constructor(private readonly deps: LogsViewDeps) {
    const back = renderReaderIconButton(renderIcon("arrow-left"), "Back to PDF");
    back.addEventListener("click", () => this.close());
    this.rawLog.addEventListener("click", () => {
      if (this.rootPath !== null) { deps.post({ command: "openRawLog", root: this.rootPath }); }
    });
    this.pane.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
    this.header = renderElement("div", { class: "rd-panel-header rd-logs-header" }, back, this.title);
    this.pane.append(this.header, this.tabs.el, this.body);
    deps.parent.append(this.pane);
  }

  get isOpen(): boolean { return !this.pane.hidden; }

  /** Shows the logs of `rootPath`, on Errors when it has any, else on All. */
  open(rootPath: string): void {
    this.rootPath = rootPath;
    this.pane.hidden = false;
    this.renderHeader();
    const hasErrors = this.root()?.problems.some((p) => p.severity === "error") ?? false;
    this.tabs.select(hasErrors ? "error" : "all", true);
  }

  close(): void {
    this.pane.hidden = true;
  }

  /** Refreshes the open view's entries in place; a closed view only keeps the roots for its next open. */
  setRoots(roots: PreviewBuildRoots): void {
    this.roots = roots;
    if (!this.isOpen) { return; }
    this.renderHeader();
    this.renderEntries();
  }

  private root(): PreviewBuildRoot | undefined {
    return this.roots?.roots.find((r) => r.path === this.rootPath);
  }

  private renderHeader(): void {
    const root = this.root();
    this.title.textContent = this.rootPath === null ? "" : deriveFileName(this.rootPath);
    if (root?.rawLog) { this.header.append(this.rawLog); } else { this.rawLog.remove(); }
    this.tabs.setCounts(root?.problems ?? []);
  }

  private renderEntries(): void {
    const { rootPath } = this;
    if (rootPath === null) { return; }
    renderEntries(this.body, this.root()?.problems ?? [], this.tabs.filter, (index) =>
      this.deps.post({ command: "openProblem", root: rootPath, index }));
  }
}
