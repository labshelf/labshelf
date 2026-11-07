// The figure editor: the workspace shell fullscreen over the note, the mode chooser of a new figure, the mode of the figure's
// kind (drawing, functions, data), its own Escape order (leave an open field, then ask before discarding changes, then close),
// the Code view, and the write (Mod-S applies, Insert figure or Done writes and closes) that hands the model and its parts to the note.
import { askDialog, createWorkspaceShell, mountOverlay, renderElement, renderIcon, type IconName, type WsShell } from "../../../ui/dom/index.js";
import { emptyFigure, newFigureId, type FigureKind, type FigureModel } from "../../chart/index.js";
import type { FigureEditorHost } from "./index.js";
import type { FigureMode, ModeContext, ModeFactory } from "./modeTypes.js";
import { createDataMode } from "./dataMode.js";
import { createDrawingMode } from "./drawingMode.js";
import { createPlotMode } from "./plotMode.js";

export { chartFigureParts, commitChart, exportChartPng } from "./chartParts.js";

const MODES: Readonly<Record<FigureKind, ModeFactory>> = { drawing: createDrawingMode, plot: createPlotMode, data: createDataMode };
const CHOICES: readonly { kind: FigureKind; icon: IconName; label: string; text: string }[] = [
  { kind: "drawing", icon: "segment", label: "Drawing", text: "Points, segments, shapes, functions and labels that become TikZ." },
  { kind: "plot", icon: "sine", label: "Functions", text: "2D and 3D plots of functions with parameters, in one or more panels." },
  { kind: "data", icon: "graph-line", label: "Data", text: "Series from a table or a CSV file, with error bars and units." },
];
const FIELDS = "input, select, textarea, [contenteditable='true'], [contenteditable='']";

interface Session {
  host: FigureEditorHost;
  shell: WsShell;
  model: FigureModel | null;
  mode: FigureMode | null;
  code: HTMLElement | null;
  dirty: boolean;
  closed: boolean;
  asking: boolean;
  committing: boolean;
  overlay: { close(): void } | null;
}

function teardown(s: Session): void {
  if (s.closed) return;
  s.closed = true;
  s.overlay?.close();
  s.mode?.destroy();
}

function discard(s: Session): void {
  teardown(s);
  s.host.done(null);
}

/** Leaves the editor, asking first when there are changes; the editor stays open when the answer is no. */
async function leave(s: Session): Promise<void> {
  if (!s.dirty) { discard(s); return; }
  if (s.asking || s.closed) return;
  s.asking = true;
  try {
    if (await askDialog("Discard changes to this figure?", "The changes made in the editor are not written to the note.", "Discard", true)) discard(s);
  } finally {
    s.asking = false;
  }
}

/** Escape: leave an open field first, then ask before discarding changes; false lets the overlay close. */
function onEscape(s: Session): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && s.shell.root.contains(active) && active.matches(FIELDS)) {
    active.blur();
    return true;
  }
  if (!s.dirty) return false;
  void leave(s);
  return true;
}

function setDirty(s: Session, dirty: boolean): void {
  s.dirty = dirty;
  s.shell.setSave(dirty ? "Unsaved changes" : "Saved", dirty ? "local" : "saved");
}

/** Writes the figure with its parts; Done closes the editor afterwards, a failed part keeps it open. */
async function commit(s: Session, closeAfter: boolean): Promise<void> {
  const model = s.model;
  if (s.committing || s.closed || model === null || s.mode === null) return;
  s.committing = true;
  s.shell.setSave("Saving…", "local");
  try {
    const result = await s.mode.parts(model);
    if (s.closed) return;
    if (result === null) { s.shell.setSave("Not saved", "error"); return; }
    s.host.done(result);
    setDirty(s, s.model !== model && s.dirty);
    if (closeAfter) teardown(s);
  } finally {
    s.committing = false;
  }
}

/** Shows or hides the Code view: the stage gives way to the text the figure writes for paper. */
async function toggleCode(s: Session): Promise<void> {
  if (s.code !== null) { s.code.remove(); s.code = null; s.shell.setCode(false); return; }
  if (s.model === null || s.mode === null) return;
  const pre = renderElement("pre", { class: "fe-code", text: await s.mode.code(s.model) });
  s.code = renderElement("div", { class: "fe-code-view" }, pre);
  s.shell.stage.append(s.code);
  s.shell.setCode(true);
}

/** Mounts the mode of the figure's kind. */
function showMode(s: Session, model: FigureModel): void {
  const ctx: ModeContext = {
    shell: s.shell,
    host: s.host,
    model: () => s.model ?? model,
    change(next) { s.model = next; setDirty(s, true); },
    table: model.src !== undefined ? s.host.table ?? null : null,
  };
  s.mode = MODES[model.kind](ctx);
  s.shell.setCrumbs([s.host.place ?? "Note", model.title ?? "Figure"]);
}

/** Starts a new figure of the kind in its mode. */
function start(s: Session, kind: FigureKind): void {
  if (s.closed || s.model !== null) return;
  const model = emptyFigure(kind, newFigureId());
  s.model = model;
  s.shell.stage.replaceChildren();
  s.shell.primary.disabled = false;
  s.shell.root.classList.remove("fe-choosing");
  setDirty(s, true);
  showMode(s, model);
}

/** The chooser of a new figure: one card per mode; the editor writes nothing until one is picked. */
function showChooser(s: Session): void {
  s.shell.primary.disabled = true;
  s.shell.root.classList.add("fe-choosing");
  s.shell.inspector.empty("Pick what kind of figure to make.");
  s.shell.status.center.textContent = "Choose a mode to start";
  const cards = CHOICES.filter((choice) => s.host.kinds?.includes(choice.kind) ?? true).map((choice) => {
    const card = renderElement("button", { type: "button", class: "fe-choice" }, renderElement("span", { class: "fe-choice-icon", html: renderIcon(choice.icon) }), renderElement("strong", { text: choice.label }), renderElement("span", { text: choice.text }));
    card.addEventListener("click", () => start(s, choice.kind));
    return card;
  });
  s.shell.stage.replaceChildren(renderElement("div", { class: "fe-chooser" }, renderElement("h2", { text: "New figure" }), renderElement("div", { class: "fe-choices" }, ...cards)));
  cards[0]?.focus();
}

/** Opens the editor over the page; `close()` removes it without writing. */
export function openFigureEditor(host: FigureEditorHost): { close(): void } {
  const isNew = host.model === null;
  // The shell's handlers reach the session, which holds the shell.
  let s!: Session;
  const shell = createWorkspaceShell({
    back: { label: `Back to ${(host.place ?? "Note").toLowerCase()}`, run: () => void leave(s) },
    crumbs: [host.place ?? "Note", "Figure"],
    code: { label: "Code", run: () => void toggleCode(s) },
    primary: { label: isNew ? "Insert figure" : "Done", run: () => void commit(s, true) },
  });
  s = { host, shell, model: host.model, mode: null, code: null, dirty: false, closed: false, asking: false, committing: false, overlay: null };
  s.shell.root.classList.add("fe");
  s.shell.root.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void commit(s, false); }
  });
  setDirty(s, false);
  const dialog = renderElement("div", { class: "ls-dialog ls-dialog-full fe-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Figure editor", tabindex: "-1" }, s.shell.root);
  s.overlay = mountOverlay(dialog, () => discard(s), { fullscreen: true, onEscape: () => onEscape(s) });
  if (host.model === null && host.kinds?.length === 1) start(s, host.kinds[0]!);
  else if (host.model === null) showChooser(s);
  else showMode(s, host.model);
  return { close: () => teardown(s) };
}
