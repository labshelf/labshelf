// Shows a build root's problems over the page area, by severity tab, with its raw log one click away.
import { el } from "../../../ui/dom/index.js";
import { icon } from "../../../ui/index.js";
import type { PreviewRoot, PreviewRoots, WebviewToHost } from "../../index.js";
import { iconButton } from "../elements/index.js";
import { fileName } from "./fileName.js";
import { renderEntries } from "./logEntries.js";
import { LogsTabs } from "./logsTabs.js";

interface LogsViewDeps {
  /** The element the pane covers: the page area, beside the sidebar. */
  parent: HTMLElement;
  post: (msg: WebviewToHost) => void;
}

export class LogsView {
  private readonly pane = el("section", { class: "rd-logs", role: "region", "aria-label": "Build logs", hidden: true });
  private readonly title = el("span", { class: "rd-logs-title" });
  private readonly rawLog = iconButton(icon("file-text"), "Open raw log");
  private readonly header: HTMLElement;
  private readonly body = el("div", { class: "rd-logs-body" });
  private readonly tabs = new LogsTabs(() => this.renderEntries());
  private roots: PreviewRoots | null = null;
  private rootPath: string | null = null;

  constructor(private readonly deps: LogsViewDeps) {
    const back = iconButton(icon("arrow-left"), "Back to PDF");
    back.addEventListener("click", () => this.close());
    this.rawLog.addEventListener("click", () => {
      if (this.rootPath !== null) { deps.post({ command: "openRawLog", root: this.rootPath }); }
    });
    this.pane.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
    this.header = el("div", { class: "rd-panel-header rd-logs-header" }, back, this.title);
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
  setRoots(roots: PreviewRoots): void {
    this.roots = roots;
    if (!this.isOpen) { return; }
    this.renderHeader();
    this.renderEntries();
  }

  private root(): PreviewRoot | undefined {
    return this.roots?.roots.find((r) => r.path === this.rootPath);
  }

  private renderHeader(): void {
    const root = this.root();
    this.title.textContent = this.rootPath === null ? "" : fileName(this.rootPath);
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
