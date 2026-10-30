// The status row a view mounts under an editor that runs cells: running with Cancel, the end states, what a missing language needs
// (with the Install Python prompt for Python), and the note that a language was restarted.
import { cellLanguageLabel, type CellLanguage, type CellResult, type CellRunState } from "../compute/index.js";
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

type CellParams = Record<string, number | string | boolean>;
/** Called once when a preview ends: with its result, or with undefined when it ended without one. */
type PreviewDone = (result: CellResult | undefined) => void;

/** The run status rows of one view, one per item, kept across re-renders so a pushed body does not lose a run in flight. */
export interface CellRunGroup {
  /**
   * Mounts the status row of `key` right after `editorEl` and returns the editor's `onRunCell`, which ignores Run while that
   * item's run is in flight; otherwise it registers a new request id and hands it with the cell's language and params to `send`.
   * A preview (a 5th argument) gets its own request id and `preview` true, runs even while a normal run is in flight, and never
   * shows in the status row; its callback is called once, by `showPreview` or by `show` with an end state.
   * `onRestart`, when given, is what `restartCell(key)` hands a language to.
   */
  attach(key: string, editorEl: HTMLElement,
    send: (label: string, code: string, requestId: string, language: CellLanguage, params?: CellParams, preview?: boolean) => void,
    onRestart?: (language: CellLanguage) => void): (label: string, code: string, language: CellLanguage, params?: CellParams, preview?: PreviewDone) => void;
  /** The editor's `onRestartCell` for `key`: shows the restarted note in its row and calls the `onRestart` given to `attach`; undefined without one. */
  restartCell(key: string): ((language: CellLanguage) => void) | undefined;
  /** Routes a host `cellState`; @returns false for a request no row of this group started. An end state ends a preview without a result. */
  show(requestId: string, state: CellRunState): boolean;
  /** Routes a host `cellPreview`: calls and forgets that preview's callback; @returns false for an unknown request. */
  showPreview(requestId: string, result: CellResult): boolean;
  /** Removes the row of `key`, e.g. when its item is gone. */
  drop(key: string): void;
  clear(): void;
}

let runSeq = 0;

/** @returns a request id unique within this page. */
function nextRequestId(): string { return `cell-${Date.now().toString(36)}-${++runSeq}`; }

interface RunRow { status: CellRunStatus; running: boolean; editorEl: HTMLElement | null; onRestart?: (language: CellLanguage) => void; previews: Map<string, PreviewDone> }

/** Shows the run in the cell whose Run was pressed (the code cell view marks it `is-run-requested`) while it is running. */
function markRunningCell(run: RunRow): void {
  const cell = run.editorEl?.querySelector(".qmd-cell.is-run-requested");
  cell?.classList.toggle("is-running", run.running);
  if (!run.running) cell?.classList.remove("is-run-requested");
}

type SendCell = Parameters<CellRunGroup["attach"]>[2];

/** Calls and forgets the callback of preview `requestId`; false when no row has it. */
function endPreview(rows: ReadonlyMap<string, RunRow>, requestId: string, result: CellResult | undefined): boolean {
  for (const run of rows.values()) {
    const done = run.previews.get(requestId);
    if (!done) continue;
    run.previews.delete(requestId);
    done(result);
    return true;
  }
  return false;
}

/** Ends the previews of a row that goes away, so its cell does not wait for them. */
function endRow(run: RunRow): void {
  run.status.el.remove();
  const pending = Array.from(run.previews.values());
  run.previews.clear();
  for (const done of pending) done(undefined);
}

/** The `onRunCell` of a row: a preview is sent at once; a normal run starts the row's status and is ignored while one is in flight. */
function rowRunner(run: RunRow, send: SendCell): ReturnType<CellRunGroup["attach"]> {
  return (label, code, language, params, preview) => {
    if (preview) {
      const requestId = nextRequestId();
      run.previews.set(requestId, preview);
      send(label, code, requestId, language, params, true);
      return;
    }
    if (run.running) return;
    const requestId = nextRequestId();
    run.running = true;
    run.status.start(requestId, label, language);
    if (params === undefined) send(label, code, requestId, language);
    else send(label, code, requestId, language, params);
  };
}

/** @returns an empty group; every row shares `options`. */
export function createCellRunGroup(options: CellRunStatusOptions): CellRunGroup {
  const rows = new Map<string, RunRow>();
  const row = (key: string): RunRow => {
    let found = rows.get(key);
    if (!found) { found = { status: createCellRunStatus(options), running: false, editorEl: null, previews: new Map() }; rows.set(key, found); }
    return found;
  };
  return {
    attach(key, editorEl, send, onRestart) {
      const run = row(key);
      run.editorEl = editorEl;
      if (onRestart) run.onRestart = onRestart; else delete run.onRestart;
      if (editorEl.nextSibling !== run.status.el) editorEl.after(run.status.el);
      return rowRunner(run, send);
    },
    restartCell(key) {
      const run = rows.get(key);
      const onRestart = run?.onRestart;
      if (!run || !onRestart) return undefined;
      return (language) => { run.status.restarted(language); onRestart(language); };
    },
    show(requestId, state) {
      for (const run of rows.values()) {
        if (run.previews.has(requestId)) { if (state !== "running") endPreview(rows, requestId, undefined); return true; }
      }
      for (const run of rows.values()) {
        if (run.status.show(requestId, state)) { run.running = state === "running"; markRunningCell(run); return true; }
      }
      return false;
    },
    showPreview: (requestId, result) => endPreview(rows, requestId, result),
    drop(key) { const run = rows.get(key); rows.delete(key); if (run) endRow(run); },
    clear() { const all = Array.from(rows.values()); rows.clear(); for (const run of all) endRow(run); },
  };
}
