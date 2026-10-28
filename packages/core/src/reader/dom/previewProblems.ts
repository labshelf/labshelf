// Shows the problems of a build preview: the limit meter, the problem marks over pages and the build logs.
import { renderElement } from "../../ui/dom/index.js";
import type { PreviewBuildRoots, WebviewToHost, CheckLimitsChange, PdfProblem, PreviewBuildRoot, PreviewProblem } from "../index.js";
import { closePopover, updatePopoverOpen, renderReaderIconButton } from "./elements.js";
import type { CountUpTo } from "../../writing/project/index.js";
import { createDebouncer } from "../../async/index.js";
import { renderAreaMark } from "./areaMark.js";
import type { PageViewLike } from "./navigation.js";
import type { ReaderContext } from "./readerSession.js";
import { renderIcon, type IconName } from "../../ui/index.js";
import { TabList } from "./toolbar.js";

// Shows body pages and words against the project's limits as a meter, with a popover that edits the limits.

interface LimitValues {
  /** The shown root's path; limits are saved per root. */
  file: string;
  pages: number | undefined;
  words: number | undefined;
  countUpTo: CountUpTo;
}

const UP_TO: Array<[CountUpTo, string]> = [["references", "References"], ["end", "End"]];

/** Reads a limit input: empty removes the limit, a positive integer sets it, anything else is undefined. */
function parseLimit(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") { return null; }
  if (!/^\d+$/.test(t)) { return undefined; }
  const n = Number(t);
  return n > 0 ? n : undefined;
}

function limitRow(id: string, label: string, value: number | undefined, commit: (input: HTMLInputElement) => void): HTMLElement {
  const input = renderElement("input", { id, class: "rd-limit-input", type: "text", inputmode: "numeric", placeholder: "none", "aria-label": label, value: value ?? "" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(input); } });
  input.addEventListener("blur", () => commit(input));
  return renderElement("div", { class: "rd-limit-row" }, renderElement("label", { for: id }, label), input);
}

/**
 * Builds the popover content for `values`.
 * @param post receives only the fields the reader changed since the content was built or last posted.
 * @param close closes the popover, for Escape.
 */
function buildLimitPopover(values: LimitValues, post: (limits: CheckLimitsChange) => void, close: () => void): HTMLElement {
  const base = { ...values };
  const commit = (field: "pages" | "words") => (input: HTMLInputElement): void => {
    const parsed = parseLimit(input.value);
    input.setAttribute("aria-invalid", String(parsed === undefined));
    if (parsed === undefined || (parsed ?? undefined) === base[field]) { return; }
    base[field] = parsed ?? undefined;
    post({ [field]: parsed });
  };

  const segment = renderElement("span", { class: "rd-limit-seg", role: "radiogroup", "aria-label": "Count up to" });
  const buttons = UP_TO.map(([value, label]) => {
    const button = renderElement("button", { type: "button", role: "radio", "aria-checked": String(base.countUpTo === value) }, label);
    button.addEventListener("click", () => {
      if (base.countUpTo === value) { return; }
      base.countUpTo = value;
      post({ countUpTo: value });
      buttons.forEach((b, i) => b.setAttribute("aria-checked", String(UP_TO[i]![0] === value)));
    });
    return button;
  });
  segment.append(...buttons);

  const content = renderElement(
    "div", { class: "rd-limit-pop" },
    limitRow("rd-limit-pages", "Page limit", base.pages, commit("pages")),
    limitRow("rd-limit-words", "Word limit", base.words, commit("words")),
    renderElement("div", { class: "rd-limit-row" }, renderElement("span", {}, "Count up to"), segment),
    renderElement("p", {}, "Counts the main text of ", renderElement("code", {}, base.file), " and every file it pulls in with ", renderElement("code", {}, "\\include"), " or ", renderElement("code", {}, "\\input"), `. Saved for ${base.file}.`),
  );
  content.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  return content;
}

interface LimitMeterDeps {
  post: (msg: WebviewToHost) => void;
  countBodyPages: () => Promise<number>;
}

const NEAR = 0.9;

const number = (n: number): string => n.toLocaleString("en-US");

/** `2 / 9 pp` against a limit, `2 pp` without one. */
const figure = (value: number, limit: number | undefined, unit: string): string =>
  limit === undefined ? `${number(value)} ${unit}` : `${number(value)} / ${number(limit)} ${unit}`;

function openLimitPopover(button: HTMLElement, roots: PreviewBuildRoots, post: (msg: WebviewToHost) => void, close: () => void): void {
  const values = { file: roots.shown, pages: roots.pageLimit, words: roots.wordLimit, countUpTo: roots.countUpTo ?? "references" };
  updatePopoverOpen(button, buildLimitPopover(values, (limits) => post({ command: "setCheckLimits", limits }), close), "above");
}

interface MeterView { button: HTMLElement; fill: HTMLElement; text: HTMLElement }

function createMeterView(slot: HTMLElement): MeterView {
  const fill = renderElement("i");
  const text = renderElement("span", { class: "rd-limit-text" });
  const button = renderElement("button", { class: "rd-limit", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Page and word limits" },
    renderElement("span", { class: "rd-limit-meter", "aria-hidden": "true" }, fill), text);
  slot.hidden = false;
  slot.append(button);
  return { button, fill, text };
}

function renderMeter({ button, fill, text }: MeterView, roots: PreviewBuildRoots | null, counted: { root: string; pages: number } | null): void {
  const shown = roots?.roots.find((r) => r.path === roots?.shown);
  const parts: string[] = [];
  const ratios: number[] = [];
  if (counted?.root === roots?.shown && counted) {
    parts.push(figure(counted.pages, roots?.pageLimit, "pp"));
    if (roots?.pageLimit !== undefined) { ratios.push(counted.pages / roots.pageLimit); }
  }
  if (shown?.words !== undefined) {
    parts.push(figure(shown.words, roots?.wordLimit, "words"));
    if (roots?.wordLimit !== undefined) { ratios.push(shown.words / roots.wordLimit); }
  }
  const ratio = Math.max(0, ...ratios);
  const state = ratio > 1 ? "over" : ratio >= NEAR ? "near" : "";
  text.textContent = parts.length > 0 ? parts.join(" · ") : "Limits";
  text.dataset["state"] = state;
  fill.className = state;
  fill.style.width = `${Math.min(100, ratio * 100)}%`;
  button.setAttribute("aria-label", parts.length > 0 ? `Limits: ${parts.join(", ")}` : "Limits");
}

/**
 * Mounts the limit meter into the footer's `limit` slot and reveals the slot.
 * Body pages are counted once per shown PDF and reported with `bodyPages`.
 * @returns `setRoots`, driven by the host's roots messages, and `documentChanged`, for a replaced PDF.
 */
export function mountLimitMeter(slot: HTMLElement, { post, countBodyPages }: LimitMeterDeps): { setRoots(roots: PreviewBuildRoots): void; documentChanged(): void } {
  const view = createMeterView(slot);
  const { button } = view;

  let roots: PreviewBuildRoots | null = null;
  let counted: { root: string; pages: number } | null = null;
  // False from a document change until the shown root is counted again.
  let fresh = false;
  // INVARIANT: only the count started last may report, so a count of a replaced document or root never lands.
  let generation = 0;
  let counting: string | null = null;

  const closeAndFocus = (): void => { closePopover(); button.focus(); };

  button.addEventListener("click", () => { if (roots) { openLimitPopover(button, roots, post, closeAndFocus); } });

  const render = (): void => renderMeter(view, roots, counted);

  async function count(root: string): Promise<void> {
    const mine = ++generation;
    counting = root;
    try {
      const pages = await countBodyPages();
      if (mine !== generation) { return; }
      counting = null;
      fresh = true;
      counted = { root, pages };
      post({ command: "bodyPages", root, contentPages: pages });
      refresh();
    } catch (err) {
      if (mine !== generation) { return; }
      counting = null;
      console.warn(`LabShelf reader: could not count the body pages of ${root}`, err);
    }
  }

  function refresh(): void {
    render();
    if (!roots) { return; }
    if (fresh && counted?.root === roots.shown) { return; }
    if (counting !== roots.shown) { void count(roots.shown); }
  }

  return {
    setRoots(next) { roots = next; refresh(); },
    documentChanged() { fresh = false; generation++; counting = null; refresh(); },
  };
}

// Marks each placed PDF problem over its area on its page and flashes one on request.

interface ProblemMarks {
  /** Replaces the marked problems; only those with an `area` get a mark. */
  setProblems(problems: readonly PdfProblem[]): void;
  /** Flashes the mark of the problem at `index` of the last `setProblems` list; an unplaced or unknown index does nothing. */
  flash(index: number): void;
}

const LAYER_CLASS = "rd-problem-marks";
const MARK_CLASS = "rd-problem-mark";
const FLASH_CLASS = "rd-problem-mark--flash";
const FLASH_MS = 1400;

export function mountProblemMarks(deps: { container: HTMLElement; pdfViewer: ReaderContext["pdfViewer"] }): ProblemMarks {
  const { container, pdfViewer } = deps;
  let problems: readonly PdfProblem[] = [];
  let flashed: readonly HTMLElement[] = [];
  const clearFlash = createDebouncer(() => { for (const mark of flashed) { mark.classList.remove(FLASH_CLASS); } }, FLASH_MS);

  const drawPage = (page: number): void => {
    const view = pdfViewer.getPageView(page - 1) as PageViewLike | undefined;
    if (!view?.viewport) { return; }
    for (const old of view.div.querySelectorAll(`.${LAYER_CLASS}`)) { old.remove(); }
    const layer = document.createElement("div");
    layer.className = LAYER_CLASS;
    layer.setAttribute("aria-hidden", "true");
    problems.forEach((problem, index) => {
      if (!problem.area || problem.area.page !== page) { return; }
      const mark = renderAreaMark(view.viewport, problem.area, { className: `${MARK_CLASS} ${MARK_CLASS}--${problem.kind}`, marginBar: problem.kind === "overfull" });
      mark.dataset.problemIndex = String(index);
      mark.setAttribute("aria-hidden", "true");
      layer.appendChild(mark);
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
      for (const stale of container.querySelectorAll(`.${FLASH_CLASS}`)) { stale.classList.remove(FLASH_CLASS); }
      for (const mark of marks) { mark.classList.add(FLASH_CLASS); }
      flashed = [...marks];
      clearFlash.call();
    },
  };
}

// Shows a build root's problems over the page area, by severity tab, with its raw log one click away.

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

// Names a build root by the last segment of its path, on either path separator.
export const deriveFileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** Names the PDF a source root builds: the same name with a `.pdf` extension. */
export const derivePdfName = (path: string): string => deriveFileName(path).replace(/\.[^.]*$/, "") + ".pdf";
