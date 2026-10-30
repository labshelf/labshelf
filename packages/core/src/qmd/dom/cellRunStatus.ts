// The status row a view mounts under an editor that runs cells: running with Cancel, the end states, what a missing language needs
// (with the Install Python prompt for Python), and the note that a language was restarted.
import { cellLanguageLabel, type CellLanguage, type CellRunState } from "../compute/index.js";
import { renderElement, renderIcon } from "../../ui/dom/index.js";

export interface CellRunStatusOptions {
  onCancel(requestId: string): void;
  /** Absent: a missing Python shows no Install Python button. Mathematica and R never show one. */
  onInstallPython?(): void;
}

export interface CellRunStatus {
  el: HTMLElement;
  /** Registers a new request for a cell of `language`, replacing any earlier one; shows nothing until the host's `running`. */
  start(requestId: string, label: string, language: CellLanguage): void;
  /** @returns false, changing nothing, for a request this status did not `start`. */
  show(requestId: string, state: CellRunState): boolean;
  owns(requestId: string): boolean;
  /** Shows that the session of `language` was restarted, so names defined by earlier runs are gone. */
  restarted(language: CellLanguage): void;
}

/** What each language needs when the host cannot run it; Python's comes with the Install Python prompt. */
const MISSING_TEXT: Readonly<Record<CellLanguage, string>> = {
  python: "Python for calculations is not installed.",
  mathematica: "Mathematica cells need Wolfram Engine or Mathematica with wolframscript.",
  r: "R cells need R (Rscript).",
};

const BASE = "qmd-run-status";

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = renderElement("button", { class: className, type: "button", text });
  el.addEventListener("click", onClick);
  return el;
}

/** @returns a status row, hidden until a run starts; it never takes focus. */
export function createCellRunStatus(options: CellRunStatusOptions): CellRunStatus {
  const el = renderElement("div", { class: BASE, role: "status", "aria-live": "polite", hidden: true });
  let current: string | null = null;
  let currentLabel = "";
  let currentLanguage: CellLanguage = "python";
  const render = (tone: string, ...children: Node[]): void => {
    el.className = tone ? `${BASE} ${BASE}-${tone}` : BASE;
    el.replaceChildren(...children);
    el.hidden = children.length === 0;
  };
  const text = (value: string): HTMLElement => renderElement("span", { class: `${BASE}-text`, text: value });
  const views: Record<Exclude<CellRunState, "running">, () => void> = {
    done: () => render(""),
    error: () => render("error", text("The cell failed; its output shows the error.")),
    cancelled: () => render("muted", text("Run cancelled.")),
    missing: () => {
      const install = currentLanguage === "python" ? options.onInstallPython : undefined;
      render("missing", text(MISSING_TEXT[currentLanguage]),
        ...(install ? [button("ls-btn ls-btn-primary", "Install Python", () => install())] : []));
    },
  };
  const running = (requestId: string, label: string): void => {
    const spinner = renderElement("span", { class: `${BASE}-spinner`, "aria-hidden": "true", html: renderIcon("loader") });
    render("running", spinner, text(label ? `Running ${label}…` : "Running cell…"),
      button("ls-btn ls-btn-ghost", "Cancel", () => options.onCancel(requestId)));
  };
  return {
    el,
    start(requestId, label, language) { current = requestId; currentLabel = label; currentLanguage = language; render(""); },
    show(requestId, state) {
      if (current === null || requestId !== current) return false;
      if (state === "running") running(requestId, currentLabel);
      else views[state]();
      return true;
    },
    owns: (requestId) => requestId === current,
    restarted: (language) => render("muted", text(`${cellLanguageLabel(language)} restarted, earlier definitions are gone.`)),
  };
}

/** The run status rows of one view, one per item, kept across re-renders so a pushed body does not lose a run in flight. */
export interface CellRunGroup {
  /**
   * Mounts the status row of `key` right after `editorEl` and returns the editor's `onRunCell`, which ignores Run while that
   * item's run is in flight; otherwise it registers a new request id and hands it with the cell's language to `send`.
   * `onRestart`, when given, is what `restartCell(key)` hands a language to.
   */
  attach(key: string, editorEl: HTMLElement, send: (label: string, code: string, requestId: string, language: CellLanguage) => void,
    onRestart?: (language: CellLanguage) => void): (label: string, code: string, language: CellLanguage) => void;
  /** The editor's `onRestartCell` for `key`: shows the restarted note in its row and calls the `onRestart` given to `attach`; undefined without one. */
  restartCell(key: string): ((language: CellLanguage) => void) | undefined;
  /** Routes a host `cellState`; @returns false for a request no row of this group started. */
  show(requestId: string, state: CellRunState): boolean;
  /** Removes the row of `key`, e.g. when its item is gone. */
  drop(key: string): void;
  clear(): void;
}

let runSeq = 0;

/** @returns a request id unique within this page. */
function nextRequestId(): string { return `cell-${Date.now().toString(36)}-${++runSeq}`; }

interface RunRow { status: CellRunStatus; running: boolean; editorEl: HTMLElement | null; onRestart?: (language: CellLanguage) => void }

/** Shows the run in the cell whose Run was pressed (the code cell view marks it `is-run-requested`) while it is running. */
function markRunningCell(run: RunRow): void {
  const cell = run.editorEl?.querySelector(".qmd-cell.is-run-requested");
  cell?.classList.toggle("is-running", run.running);
  if (!run.running) cell?.classList.remove("is-run-requested");
}

/** @returns an empty group; every row shares `options`. */
export function createCellRunGroup(options: CellRunStatusOptions): CellRunGroup {
  const rows = new Map<string, RunRow>();
  const row = (key: string): RunRow => {
    let found = rows.get(key);
    if (!found) { found = { status: createCellRunStatus(options), running: false, editorEl: null }; rows.set(key, found); }
    return found;
  };
  return {
    attach(key, editorEl, send, onRestart) {
      const run = row(key);
      run.editorEl = editorEl;
      if (onRestart) run.onRestart = onRestart; else delete run.onRestart;
      if (editorEl.nextSibling !== run.status.el) editorEl.after(run.status.el);
      return (label, code, language) => {
        if (run.running) return;
        const requestId = nextRequestId();
        run.running = true;
        run.status.start(requestId, label, language);
        send(label, code, requestId, language);
      };
    },
    restartCell(key) {
      const run = rows.get(key);
      const onRestart = run?.onRestart;
      if (!run || !onRestart) return undefined;
      return (language) => { run.status.restarted(language); onRestart(language); };
    },
    show(requestId, state) {
      for (const run of rows.values()) {
        if (run.status.show(requestId, state)) { run.running = state === "running"; markRunningCell(run); return true; }
      }
      return false;
    },
    drop(key) { rows.get(key)?.status.el.remove(); rows.delete(key); },
    clear() { for (const run of rows.values()) run.status.el.remove(); rows.clear(); },
  };
}
