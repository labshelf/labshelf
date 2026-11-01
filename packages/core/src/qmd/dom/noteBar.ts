// The note bar (plan notebook-flow D10, D12): Run all and the ⋯ note menu over the editors of one note, and the run coordinator behind them,
// which runs the cells of every editor in order and relays a cell's run to the editors after it (D7). Hosts pass actionsFor(itemId) to each editor.
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { showMenu, type MenuEntry } from "../../ui/dom/widgets/menu.js";
import { createNoteRuns, type NotebookCell, type RunScope } from "../noteRuns.js";
import type { QmdEditorHandle } from "./qmdEditor.js";
import { renderNoteOutline } from "./noteOutline.js";
import { holdsFocus } from "./problemNav.js";
import { shortcutLabel } from "./qmdCommands.js";

/** What an editor's cells and headings ask of the note: run a scope given in item-local keys, whether the note has a runner, and jump to the next / previous problem across the note's items (D12). */
export interface NoteActions { runScope(scope: import("../noteRuns.js").RunScope): void; canRun(): boolean; jumpProblem?(dir: -1 | 1): void }

/** One editor of the note, in note order. */
export interface NoteBarEditor { readonly itemId: string; readonly handle: import("./qmdEditor.js").QmdEditorHandle }

/** The title of a run control while the note has no runner. */
export const NO_RUNNER_TITLE = "No runner for this note";
const RUN_ALL_KEY = "Mod-Shift-Enter";
const NEXT_PROBLEM_KEY = "F8";
const PREVIOUS_PROBLEM_KEY = "Shift-F8";

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
 * Appends the note bar to `host`: Run all (Mod-Shift-Enter) and the ⋯ note menu, and under it the note outline panel (D15) the menu's Outline opens and closes.
 * Mounting reads only the first editor's outlineOpen(); the handles are read on an action, when the menu opens, while the outline shows and on refresh().
 * Without a runner the run controls are disabled and say why; refresh() re-reads canRun, the first editor's outline flag and the outline.
 */
export function mountNoteBar(host: HTMLElement, options: { editors(): readonly NoteBarEditor[]; flush(): Promise<void> | void; restart(language: string): Promise<void>; canRun(): boolean; menuRoot?: ShadowRoot }): { refresh(): void; destroy(): void; actionsFor(itemId: string): NoteActions; readonly runs: ReturnType<typeof import("../noteRuns.js").createNoteRuns> } {
  const runs = createNoteRuns({ cells: () => noteCells(options.editors()), flush: () => options.flush(), restart: (language) => options.restart(language) });
  const run = (scope: RunScope): void => { if (options.canRun()) void runs.run(scope); };
  const handles = (): QmdEditorHandle[] => options.editors().map((editor) => editor.handle);

  const runAll = renderElement("button", { class: "qmd-note-run-all", type: "button", "aria-label": "Run all" },
    renderElement("span", { class: "qmd-note-run-icon", html: renderIcon("play"), "aria-hidden": "true" }), "Run all");
  runAll.addEventListener("click", () => run({ kind: "all" }));
  const more = renderElement("button", { class: "qmd-note-more", type: "button", "aria-label": "Note actions", title: "Note actions", "aria-haspopup": "menu" }, "⋯");
  // Pressing the button moves the focus off the editor, so the editor that held it is read first.
  const focusedEditor = (): NoteBarEditor | undefined => options.editors().find((editor) => holdsFocus(editor.handle));
  let pressedFrom: NoteBarEditor | undefined;
  more.addEventListener("mousedown", () => { pressedFrom = focusedEditor(); });
  more.addEventListener("click", () => {
    const from = focusedEditor() ?? pressedFrom;
    pressedFrom = undefined;
    showMenu(more, menuEntries(from), options.menuRoot ? { root: options.menuRoot } : {});
  });
  const bar = renderElement("div", { class: "qmd-note-bar" }, runAll, more);
  const panel = renderElement("div", { class: "qmd-outline-panel" });
  panel.hidden = true;
  let outline: ReturnType<typeof renderNoteOutline> | null = null;

  /** Opens or closes the outline panel; the open state lives in the first editor's view state. */
  function showOutline(open: boolean): void {
    if (open === (outline !== null)) return;
    panel.hidden = !open;
    if (open) outline = renderNoteOutline(panel, () => options.editors());
    else { outline?.destroy(); outline = null; }
  }
  function toggleOutline(): void {
    const open = outline === null;
    options.editors()[0]?.handle.setOutlineOpen(open);
    showOutline(open);
  }
  const syncOutline = (): void => {
    const first = options.editors()[0];
    if (first) showOutline(first.handle.outlineOpen());
  };

  /** Selects the next (dir 1) or previous problem output after the caret of item `itemId`, then from the edge of each following (preceding) editor, wrapping round to that item itself. */
  function jumpProblem(itemId: string, dir: -1 | 1): void {
    const list = options.editors();
    const index = list.findIndex((editor) => editor.itemId === itemId);
    if (index === -1) return;
    if (list[index]!.handle.revealProblem(dir, "caret")) return;
    const others = dir > 0 ? [...list.slice(index + 1), ...list.slice(0, index)] : [...list.slice(0, index).reverse(), ...list.slice(index + 1).reverse()];
    for (const editor of [...others, list[index]!]) if (editor.handle.revealProblem(dir, "edge")) return;
  }

  /** The note menu's Next / Previous problem: from the focused editor, else from the edge of the first (last) editor. */
  function jumpFromMenu(from: NoteBarEditor | undefined, dir: -1 | 1): void {
    if (from) { jumpProblem(from.itemId, dir); return; }
    const list = options.editors();
    for (const editor of dir > 0 ? list : [...list].reverse()) if (editor.handle.revealProblem(dir, "edge")) return;
  }

  function menuEntries(from?: NoteBarEditor): MenuEntry[] {
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
      { label: "Next problem", hint: shortcutLabel(NEXT_PROBLEM_KEY), onSelect: () => jumpFromMenu(from, 1) },
      { label: "Previous problem", hint: shortcutLabel(PREVIOUS_PROBLEM_KEY), onSelect: () => jumpFromMenu(from, -1) },
      { label: "Outline", checked: outline !== null, onSelect: toggleOutline },
    ];
  }

  function refresh(): void {
    const can = options.canRun();
    runAll.disabled = !can;
    runAll.title = can ? `Run all (${shortcutLabel(RUN_ALL_KEY)})` : NO_RUNNER_TITLE;
    syncOutline();
    outline?.refresh();
  }

  refresh();
  host.append(bar, panel);
  return {
    refresh,
    destroy: () => {
      outline?.destroy();
      outline = null;
      bar.remove();
      panel.remove();
    },
    actionsFor: (itemId) => ({ runScope: (scope) => run(noteScope(itemId, scope)), canRun: () => options.canRun(), jumpProblem: (dir) => jumpProblem(itemId, dir) }),
    runs,
  };
}
