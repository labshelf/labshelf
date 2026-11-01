// The note bar (plan notebook-flow D10, D12): Run all and the ⋯ note menu over the editors of one note, and the run coordinator behind them,
// which runs the cells of every editor in order and relays a cell's run to the editors after it (D7). Hosts pass actionsFor(itemId) to each editor.
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { showMenu, type MenuEntry } from "../../ui/dom/widgets/menu.js";
import { createNoteRuns, type NotebookCell, type RunScope } from "../noteRuns.js";
import type { QmdEditorHandle } from "./qmdEditor.js";
import { shortcutLabel } from "./qmdCommands.js";

/** What an editor's cells and headings ask of the note: run a scope given in item-local keys, and whether the note has a runner. */
export interface NoteActions { runScope(scope: import("../noteRuns.js").RunScope): void; canRun(): boolean }

/** One editor of the note, in note order. */
export interface NoteBarEditor { readonly itemId: string; readonly handle: import("./qmdEditor.js").QmdEditorHandle }

/** The title of a run control while the note has no runner. */
export const NO_RUNNER_TITLE = "No runner for this note";
const RUN_ALL_KEY = "Mod-Shift-Enter";

/**
 * The cells of every editor in order, as the run coordinator drives them: section keys prefixed with the item id, so a section never spans
 * items (D8), and a run that ended ok or with an error marked as an upstream change on every later editor (D7).
 */
function noteCells(editors: readonly NoteBarEditor[]): NotebookCell[] {
  return editors.flatMap(({ itemId, handle }, index) => handle.notebook(itemId).map((cell): NotebookCell => ({
    key: cell.key,
    itemId: cell.itemId,
    language: cell.language,
    sectionKeys: cell.sectionKeys.map((section) => `${itemId}#${section}`),
    run: async () => {
      const end = await cell.run();
      if (end === "ok" || end === "error") for (const later of editors.slice(index + 1)) later.handle.markUpstreamChange(cell.language, Date.now());
      return end;
    },
    cancel: () => cell.cancel(),
    setQueue: (state) => cell.setQueue(state),
  })));
}

/** A scope in an item's local keys as the coordinator's note-wide keys. */
function noteScope(itemId: string, scope: RunScope): RunScope {
  switch (scope.kind) {
    case "above":
    case "below":
      return { kind: scope.kind, cell: `${itemId}#${scope.cell}` };
    case "section":
      return { kind: "section", section: `${itemId}#${scope.section}` };
    default:
      return scope;
  }
}

/**
 * Appends the note bar to `host`: Run all (Mod-Shift-Enter) and the ⋯ note menu. Mounting touches no editor handle; they are read only on an action,
 * when the menu opens and on refresh(). Without a runner the run controls are disabled and say why; refresh() re-reads canRun.
 */
export function mountNoteBar(host: HTMLElement, options: { editors(): readonly NoteBarEditor[]; flush(): Promise<void> | void; restart(language: string): Promise<void>; canRun(): boolean; menuRoot?: ShadowRoot }): { refresh(): void; destroy(): void; actionsFor(itemId: string): NoteActions; readonly runs: ReturnType<typeof import("../noteRuns.js").createNoteRuns> } {
  const runs = createNoteRuns({ cells: () => noteCells(options.editors()), flush: () => options.flush(), restart: (language) => options.restart(language) });
  const run = (scope: RunScope): void => { if (options.canRun()) void runs.run(scope); };
  const handles = (): QmdEditorHandle[] => options.editors().map((editor) => editor.handle);

  const runAll = renderElement("button", { class: "qmd-note-run-all", type: "button", "aria-label": "Run all" },
    renderElement("span", { class: "qmd-note-run-icon", html: renderIcon("play"), "aria-hidden": "true" }), "Run all");
  runAll.addEventListener("click", () => run({ kind: "all" }));
  const more = renderElement("button", { class: "qmd-note-more", type: "button", "aria-label": "Note actions", title: "Note actions", "aria-haspopup": "menu" }, "⋯");
  more.addEventListener("click", () => showMenu(more, menuEntries(), options.menuRoot ? { root: options.menuRoot } : {}));
  const bar = renderElement("div", { class: "qmd-note-bar" }, runAll, more);

  function menuEntries(): MenuEntry[] {
    const can = options.canRun();
    const runEntry = (label: string, scope: RunScope, hint?: string): MenuEntry => ({
      label, ...(hint ? { hint } : {}), ...(can ? {} : { disabled: true, title: NO_RUNNER_TITLE }), onSelect: () => run(scope),
    });
    const all = handles();
    const reading = all.length > 0 && all.every((handle) => handle.foldState().reading);
    return [
      runEntry("Run all", { kind: "all" }, shortcutLabel(RUN_ALL_KEY)),
      runEntry("Restart and run all", { kind: "restartAll" }),
      "separator",
      { label: "Collapse all", onSelect: () => { for (const handle of handles()) handle.collapseAll(); } },
      { label: "Expand all", onSelect: () => { for (const handle of handles()) handle.expandAll(); } },
      { label: "Reading mode", checked: reading, onSelect: () => { for (const handle of handles()) handle.setReading(!reading); } },
    ];
  }

  function refresh(): void {
    const can = options.canRun();
    runAll.disabled = !can;
    runAll.title = can ? `Run all (${shortcutLabel(RUN_ALL_KEY)})` : NO_RUNNER_TITLE;
  }

  refresh();
  host.append(bar);
  return {
    refresh,
    destroy: () => bar.remove(),
    actionsFor: (itemId) => ({ runScope: (scope) => run(noteScope(itemId, scope)), canRun: () => options.canRun() }),
    runs,
  };
}
