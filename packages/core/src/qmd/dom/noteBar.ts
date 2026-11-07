// The note bar (plan notebook-flow D10, D12): Run all, the Advanced switch and the ⋯ note menu over the editors of one note, and the run coordinator behind
// them, which runs the cells of every editor in order and relays a cell's run to the editors after it (D7). Hosts pass actionsFor(itemId) to each editor.
// With Advanced on (plan advanced-notes D7) the bar is a header that shows the menu's actions as buttons too.
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import { showMenu, type MenuEntry } from "../../ui/dom/widgets/index.js";
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

type BarOptions = Parameters<typeof mountNoteBar>[1];

/** Selects the next (dir 1) or previous problem output after the caret of item `itemId`, then from the edge of each following (preceding) editor, wrapping round to that item itself. */
function jumpProblem(editors: () => readonly NoteBarEditor[], itemId: string, dir: -1 | 1): void {
  const list = editors();
  const index = list.findIndex((editor) => editor.itemId === itemId);
  if (index === -1) return;
  if (list[index]!.handle.revealProblem(dir, "caret")) return;
  const others = dir > 0 ? [...list.slice(index + 1), ...list.slice(0, index)] : [...list.slice(0, index).reverse(), ...list.slice(index + 1).reverse()];
  for (const editor of [...others, list[index]!]) if (editor.handle.revealProblem(dir, "edge")) return;
}

/** The note menu's Next / Previous problem: from the focused editor, else from the edge of the first (last) editor. */
function jumpFromMenu(editors: () => readonly NoteBarEditor[], from: NoteBarEditor | undefined, dir: -1 | 1): void {
  if (from) { jumpProblem(editors, from.itemId, dir); return; }
  const list = editors();
  for (const editor of dir > 0 ? list : [...list].reverse()) if (editor.handle.revealProblem(dir, "edge")) return;
}

/** The outline panel under the bar (D15): opens and closes it, and keeps the open state in the first editor's view state. */
function createOutlinePanel(editors: () => readonly NoteBarEditor[]): { panel: HTMLElement; isOpen(): boolean; toggle(): void; sync(): void; refresh(): void; destroy(): void } {
  const panel = renderElement("div", { class: "qmd-outline-panel" });
  panel.hidden = true;
  let outline: ReturnType<typeof renderNoteOutline> | null = null;
  const show = (open: boolean): void => {
    if (open === (outline !== null)) return;
    panel.hidden = !open;
    if (open) outline = renderNoteOutline(panel, editors);
    else { outline?.destroy(); outline = null; }
  };
  return {
    panel,
    isOpen: () => outline !== null,
    toggle: () => {
      const open = outline === null;
      editors()[0]?.handle.setOutlineOpen(open);
      show(open);
    },
    sync: () => {
      const first = editors()[0];
      if (first) show(first.handle.outlineOpen());
    },
    refresh: () => outline?.refresh(),
    destroy: () => { outline?.destroy(); outline = null; panel.remove(); },
  };
}

/** The entries of the ⋯ note menu, opened from `from`, the editor that held the focus. */
function noteMenuEntries(options: BarOptions, run: (scope: RunScope) => void, outline: { isOpen(): boolean; toggle(): void }, from?: NoteBarEditor): MenuEntry[] {
  const can = options.canRun();
  const runEntry = (label: string, scope: RunScope, hint?: string): MenuEntry => ({
    label, ...(hint ? { hint } : {}), ...(can ? {} : { disabled: true, title: NO_RUNNER_TITLE }), onSelect: () => run(scope),
  });
  const handles = (): QmdEditorHandle[] => options.editors().map((editor) => editor.handle);
  return [
    runEntry("Run all", { kind: "all" }, shortcutLabel(RUN_ALL_KEY)),
    runEntry("Restart and run all", { kind: "restartAll" }),
    "separator",
    { label: "Collapse all", onSelect: () => { for (const handle of handles()) handle.collapseAll(); } },
    { label: "Expand all", onSelect: () => { for (const handle of handles()) handle.expandAll(); } },
    { label: "Next problem", hint: shortcutLabel(NEXT_PROBLEM_KEY), onSelect: () => jumpFromMenu(() => options.editors(), from, 1) },
    { label: "Previous problem", hint: shortcutLabel(PREVIOUS_PROBLEM_KEY), onSelect: () => jumpFromMenu(() => options.editors(), from, -1) },
    { label: "Outline", checked: outline.isOpen(), onSelect: outline.toggle },
  ];
}

/** A bar button: its icon and its label. */
function barButton(className: string, icon: IconName, label: string, title = label): HTMLButtonElement {
  return renderElement("button", { class: className, type: "button", title },
    renderElement("span", { class: "qmd-note-bar-icon", html: renderIcon(icon), "aria-hidden": "true" }), label);
}

/** Calls `act` with the editor that held the focus before a press on `button` (pressing moves the focus off the editor, so it is read on mousedown). */
function onPress(options: BarOptions, button: HTMLButtonElement, act: (from?: NoteBarEditor) => void): void {
  const focusedEditor = (): NoteBarEditor | undefined => options.editors().find((editor) => holdsFocus(editor.handle));
  let pressedFrom: NoteBarEditor | undefined;
  button.addEventListener("mousedown", () => { pressedFrom = focusedEditor(); });
  button.addEventListener("click", () => {
    const from = focusedEditor() ?? pressedFrom;
    pressedFrom = undefined;
    act(from);
  });
}

/** The header's tools, shown with Advanced on: the note menu's actions as buttons, and Insert at the caret of the editor that held the focus (else the first). */
function renderTools(options: BarOptions, run: (scope: RunScope) => void, outline: { isOpen(): boolean; toggle(): void }): { tools: HTMLElement; sync(): void } {
  const handles = (): QmdEditorHandle[] => options.editors().map((editor) => editor.handle);
  const restart = barButton("qmd-note-tool", "refresh", "Restart and run all");
  restart.addEventListener("click", () => run({ kind: "restartAll" }));
  const collapse = barButton("qmd-note-tool", "collapse-all", "Collapse all");
  collapse.addEventListener("click", () => { for (const handle of handles()) handle.collapseAll(); });
  const expand = barButton("qmd-note-tool", "layers", "Expand all");
  expand.addEventListener("click", () => { for (const handle of handles()) handle.expandAll(); });
  const previous = barButton("qmd-note-tool", "chevron-up", "Previous problem", `Previous problem (${shortcutLabel(PREVIOUS_PROBLEM_KEY)})`);
  onPress(options, previous, (from) => jumpFromMenu(() => options.editors(), from, -1));
  const next = barButton("qmd-note-tool", "chevron-down", "Next problem", `Next problem (${shortcutLabel(NEXT_PROBLEM_KEY)})`);
  onPress(options, next, (from) => jumpFromMenu(() => options.editors(), from, 1));
  const outlineButton = barButton("qmd-note-tool", "list", "Outline");
  outlineButton.addEventListener("click", () => { outline.toggle(); sync(); });
  const insert = barButton("qmd-note-tool", "plus", "Insert");
  insert.setAttribute("aria-haspopup", "dialog");
  onPress(options, insert, (from) => (from ?? options.editors()[0])?.handle.openInsertMenu(insert));
  function sync(): void {
    const can = options.canRun();
    restart.disabled = !can;
    restart.title = can ? "Restart and run all" : NO_RUNNER_TITLE;
    outlineButton.setAttribute("aria-pressed", String(outline.isOpen()));
  }
  const tools = renderElement("div", { class: "qmd-note-tools", role: "group", "aria-label": "Note tools" }, insert, restart, collapse, expand, previous, next, outlineButton);
  return { tools, sync };
}

/**
 * The bar: Run all, the Advanced switch and ⋯ (the header's tools go first while Advanced is on), whose menu lists `menuEntries(from)`, `from` being the
 * editor that held the focus before the press. `toggleAdvanced` flips the switch.
 */
function renderBar(options: BarOptions, run: (scope: RunScope) => void, menuEntries: (from?: NoteBarEditor) => MenuEntry[], toggleAdvanced: () => void): { bar: HTMLElement; runAll: HTMLButtonElement; advanced: HTMLButtonElement } {
  const runAll = renderElement("button", { class: "qmd-note-run-all", type: "button", "aria-label": "Run all" },
    renderElement("span", { class: "qmd-note-run-icon", html: renderIcon("play"), "aria-hidden": "true" }), "Run all");
  runAll.addEventListener("click", () => run({ kind: "all" }));
  const advanced = barButton("qmd-note-advanced", "code", "Advanced", "Show every cell's code, the line numbers and the note tools");
  advanced.setAttribute("aria-pressed", "false");
  advanced.addEventListener("click", toggleAdvanced);
  const more = renderElement("button", { class: "qmd-note-more", type: "button", "aria-label": "Note actions", title: "Note actions", "aria-haspopup": "menu" }, "⋯");
  onPress(options, more, (from) => showMenu(more, menuEntries(from), options.menuRoot ? { root: options.menuRoot } : {}));
  return { bar: renderElement("div", { class: "qmd-note-bar" }, runAll, advanced, more), runAll, advanced };
}

/**
 * Appends the note bar to `host`: Run all (Mod-Shift-Enter), the Advanced switch and the ⋯ note menu, and under it the note outline panel (D15) the
 * menu's Outline opens and closes. The switch sets every editor; the bar follows the first editor's flag and hands it to editors that differ (an item
 * added later). Mounting reads only the first editor; the handles are read on an action, when the menu opens, while the outline shows and on refresh().
 * Without a runner the run controls are disabled and say why; refresh() re-reads canRun, the first editor's outline and Advanced flags and the outline.
 */
export function mountNoteBar(host: HTMLElement, options: { editors(): readonly NoteBarEditor[]; flush(): Promise<void> | void; restart(language: string): Promise<void>; canRun(): boolean; menuRoot?: ShadowRoot }): { refresh(): void; destroy(): void; actionsFor(itemId: string): NoteActions; readonly runs: ReturnType<typeof import("../noteRuns.js").createNoteRuns> } {
  const runs = createNoteRuns({ cells: () => noteCells(options.editors()), flush: () => options.flush(), restart: (language) => options.restart(language) });
  const run = (scope: RunScope): void => { if (options.canRun()) void runs.run(scope); };
  const outline = createOutlinePanel(() => options.editors());
  const tools = renderTools(options, run, outline);
  let on = false;
  const setAdvanced = (next: boolean): void => {
    on = next;
    for (const { handle } of options.editors()) if (handle.advanced() !== on) handle.setAdvanced(on);
    bar.classList.toggle("is-advanced", on);
    // The tools are in the bar only while they show.
    if (on) bar.prepend(tools.tools);
    else tools.tools.remove();
    advanced.setAttribute("aria-pressed", String(on));
  };
  const { bar, runAll, advanced } = renderBar(options, run, (from) => noteMenuEntries(options, run, { isOpen: outline.isOpen, toggle: () => { outline.toggle(); tools.sync(); } }, from), () => setAdvanced(!on));

  function refresh(): void {
    const can = options.canRun();
    runAll.disabled = !can;
    runAll.title = can ? `Run all (${shortcutLabel(RUN_ALL_KEY)})` : NO_RUNNER_TITLE;
    setAdvanced(options.editors()[0]?.handle.advanced() ?? on);
    outline.sync();
    outline.refresh();
    tools.sync();
  }

  refresh();
  host.append(bar, outline.panel);
  return {
    refresh,
    destroy: () => { outline.destroy(); bar.remove(); },
    actionsFor: (itemId) => ({ runScope: (scope) => run(noteScope(itemId, scope)), canRun: () => options.canRun(), jumpProblem: (dir) => jumpProblem(() => options.editors(), itemId, dir) }),
    runs,
  };
}
