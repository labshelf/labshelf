// The HTML deck in the deck shell: the bare deck editor on the stage with the shell's header, insert bar, zoom bar, status and keys,
// and the HTML parts (left panel, floating bar, a poster's rulers, a talk's speaker notes, properties); all redrawn from the editor's view.
import { renderElement, renderIcon, type IconName } from "../../../../ui/dom/index.js";
import { setDeckSlideNotes } from "../../../deckBlocks.js";
import { applyDeckEdit } from "../../../deckEdit.js";
import { openDeckEditor } from "../../deckEditorMount.js";
import type { DeckEditorView } from "../../deckEditorCore.js";
import { createSizePopover } from "../../sizePicker.js";
import { createThemePopover, type ToolbarPopover } from "../../themePanel.js";
import { createShellHeader, createShellStatus, createZoomBar, createInsertBar, bindShellKeys, mountDeckShell, type DeckShellMode, type InsertItem, type ShellHeaderSpec, type ShellKeyActions, type ShellStatusParts, type ShellTool, type ShellZoomBar } from "../index.js";
import { SLIDE_LAYOUTS, deleteSelected, duplicateSelected, insertBlock, newSlide } from "./actions.js";
import { createLeftPanel } from "./left.js";
import { createPropertiesPanel } from "./props.js";
import { createFloatingBar, createRulers } from "./stageTools.js";
import type { DeckWorkspaceController, DeckWorkspaceOptions, ShellContext } from "./types.js";

/** The header of an HTML deck; `onMode` switches between the visual editor and the HTML source. */
function headerSpec(ctx: ShellContext, onMode: (mode: DeckShellMode) => void): ShellHeaderSpec {
  const { commands = {} } = ctx.options;
  const poster = ctx.view.model?.kind === "poster";
  const exports: Array<{ label: string; icon: IconName; run(): void }> = [
    ...(commands.exportPdf ? [{ label: "PDF", icon: "file-text" as const, run: () => commands.exportPdf!() }] : []),
    ...(commands.exportHtml ? [{ label: "HTML file", icon: "code" as const, run: () => commands.exportHtml!() }] : []),
    ...(commands.shareLink ? [{ label: "Share link", icon: "link" as const, run: () => commands.shareLink!() }] : []),
  ];
  const show = poster ? commands.preview : commands.present;
  return {
    title: ctx.options.title,
    badge: poster ? "Poster" : "Talk",
    modes: ["visual", "code"],
    onMode,
    saved: true,
    ...(show ? { show: { label: poster ? "Preview" : "Present", icon: poster ? "eye" as const : "play" as const, run: () => show() } } : {}),
    exports,
  };
}

interface HtmlInsertBar { element: HTMLElement; refresh(): void; popovers: ToolbarPopover[] }

function createHtmlInsertBar(ctx: ShellContext): HtmlInsertBar {
  const readOnly = (): string | undefined => (ctx.view.readOnly ? "Fix the deck's problems first" : undefined);
  const theme = createThemePopover({ theme: () => ctx.view.theme, onChange: (name, value) => ctx.editor.editTheme(name, value) });
  const size = createSizePopover({ current: () => ctx.view.model, onApply: (next) => ctx.edit([(html) => applyDeckEdit(html, { kind: "setSize", size: next, scale: true })], "Change size") });
  for (const popover of [theme, size]) { popover.button.classList.add("dw-insert"); popover.button.insertAdjacentHTML("afterbegin", renderIcon(popover === theme ? "droplet" : "grid")); }
  const history: InsertItem[] = [
    { icon: "discard", label: "Undo", run: () => ctx.editor.undo(), disabled: () => (ctx.view.canUndo ? undefined : "Nothing to undo") },
    { icon: "reload", label: "Redo", run: () => ctx.editor.redo(), disabled: () => (ctx.view.canRedo ? undefined : "Nothing to redo") },
  ];
  const blocks: InsertItem[] = [
    { icon: "text-box", label: "Text", run: () => void insertBlock(ctx, "text"), disabled: readOnly },
    { icon: "file-media", label: "Image", run: () => void insertBlock(ctx, "image"), disabled: () => readOnly() ?? (ctx.options.pickImage ? undefined : "This editor cannot pick images") },
    { icon: "sigma", label: "Equation", run: () => void insertBlock(ctx, "equation"), disabled: readOnly },
    { icon: "layers", label: "Shapes", disabled: readOnly, menu: () => (["rect", "ellipse", "line"] as const).map((kind) => ({ label: { rect: "Rectangle", ellipse: "Ellipse", line: "Line" }[kind], onSelect: () => void insertBlock(ctx, kind) })) },
  ];
  const layout: InsertItem = { icon: "panel-left", label: "New slide", disabled: readOnly, menu: () => SLIDE_LAYOUTS.map(([id, label]) => ({ label, onSelect: () => newSlide(ctx, id) })) };
  const bar = createInsertBar([history, blocks, ...(ctx.view.model?.kind === "poster" ? [] : [[layout]])], [theme.element, size.element]);
  return {
    element: bar.element,
    popovers: [theme, size],
    refresh() {
      bar.refresh();
      for (const popover of [theme, size]) { popover.button.disabled = ctx.view.readOnly; if (ctx.view.readOnly) popover.close(); popover.refresh(); }
    },
  };
}

/** The status parts: where the editor is, the gesture hint, and the save state or the deck's problems. */
function statusParts(ctx: ShellContext, saved: boolean): ShellStatusParts {
  const { model, slide, readOnly, errors, notice } = ctx.view;
  const size = model?.size ? `${model.size.w} × ${model.size.h} ${model.size.unit}` : "";
  const problem = readOnly ? `This deck has errors and opens read-only: ${errors.join("; ")}` : notice;
  return {
    left: model?.kind === "poster" ? `Poster · ${size}` : `Slide ${slide + 1} of ${model?.slides.length ?? 0} · ${size}`,
    hint: "Drag to move · Double-click to edit text",
    state: problem ? { tone: "problem", text: problem } : { tone: saved ? "saved" : "dirty", text: saved ? "All changes saved" : "Unsaved changes" },
  };
}

/** The speaker notes under a talk's stage: written when the field loses focus, folded with its heading. */
function createNotes(ctx: ShellContext): { element: HTMLElement; render(): void } {
  const area = renderElement("textarea", { class: "dw-notes-input", placeholder: "Speaker notes for this slide", "aria-label": "Speaker notes" });
  const fold = renderElement("button", { type: "button", class: "dsh-notes-head", "aria-expanded": "true", html: renderIcon("chevron-down") });
  fold.prepend(renderElement("span", { text: "Speaker notes" }));
  const element = renderElement("section", { class: "dw-notes dsh-notes" }, fold, area);
  fold.addEventListener("click", () => { const open = fold.getAttribute("aria-expanded") !== "true"; fold.setAttribute("aria-expanded", String(open)); area.hidden = !open; });
  area.addEventListener("keydown", (event) => event.stopPropagation());
  area.addEventListener("change", () => { const slide = ctx.view.slide; ctx.edit([(html) => setDeckSlideNotes(html, slide, area.value)], "Speaker notes"); });
  return {
    element,
    render() {
      element.hidden = ctx.view.model?.kind === "poster" || ctx.view.readOnly;
      if (document.activeElement !== area) area.value = ctx.view.model?.slides[ctx.view.slide]?.notes?.text ?? "";
    },
  };
}

const EMPTY_VIEW: DeckEditorView = { html: "", theme: "", model: undefined, slide: 0, blocks: [], readOnly: false, scale: 1, fit: true, notice: "", canUndo: false, canRedo: false, errors: [] };

/** The shell's keys over the editor: none while read-only, while a leaf is being edited or during a drag. */
function keyActions(ctx: ShellContext, zoom: ShellZoomBar): ShellKeyActions {
  const idle = (): boolean => !ctx.view.readOnly && !["is-editing", "is-dragging"].some((name) => ctx.editor.element.classList.contains(name));
  let held: ShellTool | undefined;
  const actions: ShellKeyActions = {
    undo: () => ctx.editor.undo(),
    redo: () => ctx.editor.redo(),
    zoomIn: () => zoom.zoomIn(),
    zoomOut: () => zoom.zoomOut(),
    fit: () => zoom.fit(),
    setTool: (tool) => zoom.setTool(tool),
    holdHand(on) {
      if (on && held === undefined) { held = zoom.tool(); zoom.setTool("hand"); } else if (!on && held !== undefined) { zoom.setTool(held); held = undefined; }
    },
    previous: () => ctx.editor.selectSlide(ctx.view.slide - 1),
    next: () => ctx.editor.selectSlide(ctx.view.slide + 1),
    deleteSelection: () => deleteSelected(ctx),
    clearSelection: () => ctx.editor.selectBlocks([]),
    duplicate: () => duplicateSelected(ctx),
  };
  if (ctx.view.model?.kind === "poster") { delete actions.previous; delete actions.next; }
  return Object.fromEntries(Object.entries(actions).map(([key, run]) => [key, (...args: unknown[]) => { if (idle() || (key === "holdHand" && args[0] === false)) (run as (...a: unknown[]) => void)(...args); }])) as ShellKeyActions;
}

/** The shell context over a deck editor mounted in `centre`; `onRender` runs after every render of the editor. */
function createShellContext(centre: HTMLElement, options: DeckWorkspaceOptions, onRender: () => void): ShellContext {
  const ctx: ShellContext = {
    options, view: EMPTY_VIEW, editor: undefined!,
    edit(steps, label, select) {
      ctx.editor.edit(steps, label);
      if (select) ctx.editor.selectBlocks(select);
    },
  };
  ctx.editor = openDeckEditor(centre, { ...options, onRender(view) { ctx.view = view; onRender(); } });
  return ctx;
}

/** The zoom bar driving the editor's zoom and tool. */
function createEditorZoomBar(ctx: ShellContext): ReturnType<typeof createZoomBar> {
  return createZoomBar({
    percent: () => ctx.view.scale * 100,
    isFit: () => ctx.view.fit,
    setZoom: (next) => ctx.editor.setZoom(next === "fit" ? "fit" : next / 100),
    setTool: (tool) => ctx.editor.setTool(tool),
  });
}

/** Marks the stage as ruled when there are rulers and adds the rulers and the floating bar to it. */
function mountStageOverlays(centre: HTMLElement, rulers: HTMLElement | undefined, floating: HTMLElement): void {
  centre.classList.toggle("has-rulers", rulers !== undefined);
  centre.append(...(rulers ? [rulers] : []), floating);
}

/** Opens an HTML talk or poster in the deck shell in `host`. */
export function openDeckWorkspace(host: HTMLElement, options: DeckWorkspaceOptions): DeckWorkspaceController {
  const centre = renderElement("div", { class: "dsh-centre" });
  const state = { saved: true };
  let render = (): void => undefined;
  const ctx = createShellContext(centre, options, () => render());
  let mode: DeckShellMode = "visual";
  const setMode = (next: DeckShellMode): void => {
    if ((next === "code") !== (mode === "code")) ctx.editor.toggleSource();
    mode = next;
    header.setMode(next);
    shell.setMode(next);
  };
  const header = createShellHeader(headerSpec(ctx, setMode));
  const insert = createHtmlInsertBar(ctx);
  const left = createLeftPanel(ctx);
  const props = createPropertiesPanel(ctx);
  const zoom = createEditorZoomBar(ctx);
  const floating = createFloatingBar(ctx);
  const rulers = ctx.view.model?.kind === "poster" ? createRulers(ctx) : undefined;
  const notes = createNotes(ctx);
  const status = createShellStatus();
  mountStageOverlays(centre, rulers?.element, floating.element);
  const shell = mountDeckShell(host, {
    format: "html", kind: ctx.view.model?.kind ?? "talk",
    header: header.element, insert: insert.element, left: left.element, stage: centre, zoom: zoom.element, props: props.element, status: status.element, notes: notes.element,
  });
  shell.root.classList.add("dsh");
  header.setMode(mode);
  const unbindKeys = bindShellKeys(shell.root, keyActions(ctx, zoom));
  const onScroll = (): void => { floating.render(); rulers?.render(); };
  ctx.editor.viewport.addEventListener("scroll", onScroll, { passive: true });
  render = () => {
    header.setSaved(state.saved);
    insert.refresh(); left.render(); props.render(); zoom.render(); notes.render(); status.set(statusParts(ctx, state.saved));
    requestAnimationFrame(onScroll);
  };
  render();
  return {
    ...ctx.editor,
    get element() { return shell.root; },
    setSaved(saved) { state.saved = saved; render(); },
    destroy() {
      unbindKeys();
      left.destroy();
      for (const popover of insert.popovers) popover.destroy();
      ctx.editor.destroy();
      shell.destroy();
    },
  };
}
