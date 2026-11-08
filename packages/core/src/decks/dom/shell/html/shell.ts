// The HTML deck in the deck shell: the bare deck editor on the stage with the shell's header, insert bar, zoom bar, status and keys,
// and the HTML parts (left panel, floating bar, a poster's rulers, a talk's speaker notes, properties); all redrawn from the editor's view.
import { renderElement, renderIcon, type IconName } from "../../../../ui/dom/index.js";
import { setDeckSlideNotes } from "../../../deckBlocks.js";
import { applyDeckEdit } from "../../../deckEdit.js";
import { openDeckEditor } from "../../deckEditorMount.js";
import type { DeckEditorView } from "../../deckEditorCore.js";
import { createSizePopover } from "../../sizePicker.js";
import { createDeckThumbnails } from "../../slideThumbnails.js";
import type { ToolbarPopover } from "../../toolbarPopover.js";
import { DEFAULT_DECK_STYLE, type DeckStyle } from "../../../deckStyleTokens.js";
import { readThemeStyle, setThemeStyle } from "../../../deckStyleCss.js";
import { createShellHeader, createShellStatus, createZoomBar, createInsertBar, bindShellKeys, mountDeckShell, shellButton, type DeckShellMode, type InsertItem, type ShellHeaderSpec, type ShellKeyActions, type ShellRect, type ShellStatusParts, type ShellTool, type ShellZoomBar, type ShellZoomSurface, type ShellZoomTarget } from "../index.js";
import { createMinimap, fitRectZoom } from "../../minimap.js";
import { mountStylePanel, type DeckStylePort } from "../../style/index.js";
import { readPosterLayout, type PosterBox } from "../../../posterSections.js";
import { canvasOf, deleteSelected, duplicateSelected, editChart, insertBlock, newSlide, selectedBlock } from "./actions.js";
import { readDeckChart } from "../../../deckCharts.js";
import { DECK_SLIDE_LAYOUTS } from "../../../deckSlideLayouts.js";
import { findDeckBlock } from "../../../deckStyle.js";
import { copySelected, groupSelected, pasteClipboard, ungroupSelected } from "./arrange.js";
import { createLeftPanel } from "./left.js";
import { createPropertiesPanel } from "./props.js";
import { createFloatingBar, createRulers } from "./stageTools.js";
import { createPosterSettings } from "./posterSettings.js";
import { createPosterStage } from "./posterStage.js";
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

function createHtmlInsertBar(ctx: ShellContext, panels: readonly HTMLElement[]): HtmlInsertBar {
  const readOnly = (): string | undefined => (ctx.view.readOnly ? "Fix the deck's problems first" : undefined);
  const size = createSizePopover({ current: () => ctx.view.model, onApply: (next) => ctx.edit([(html) => applyDeckEdit(html, { kind: "setSize", size: next, scale: true })], "Change size") });
  size.button.classList.add("dw-insert");
  size.button.insertAdjacentHTML("afterbegin", renderIcon("grid"));
  const history: InsertItem[] = [
    { icon: "discard", label: "Undo", run: () => ctx.editor.undo(), disabled: () => (ctx.view.canUndo ? undefined : "Nothing to undo") },
    { icon: "reload", label: "Redo", run: () => ctx.editor.redo(), disabled: () => (ctx.view.canRedo ? undefined : "Nothing to redo") },
  ];
  const blocks: InsertItem[] = [
    { icon: "text-box", label: "Text", run: () => void insertBlock(ctx, "text"), disabled: readOnly },
    { icon: "file-media", label: "Image", run: () => void insertBlock(ctx, "image"), disabled: () => readOnly() ?? (ctx.options.pickImage ? undefined : "This editor cannot pick images") },
    { icon: "sigma", label: "Equation", run: () => void insertBlock(ctx, "equation"), disabled: readOnly },
    { icon: "chart-line", label: "Chart", run: () => void insertBlock(ctx, "chart"), disabled: readOnly },
    { icon: "layers", label: "Shapes", disabled: readOnly, menu: () => (["rect", "ellipse", "line"] as const).map((kind) => ({ label: { rect: "Rectangle", ellipse: "Ellipse", line: "Line" }[kind], onSelect: () => void insertBlock(ctx, kind) })) },
  ];
  const layout: InsertItem = { icon: "panel-left", label: "New slide", disabled: readOnly, menu: () => DECK_SLIDE_LAYOUTS.map(([id, label]) => ({ label, onSelect: () => newSlide(ctx, id) })) };
  const bar = createInsertBar([history, blocks, ...(ctx.view.model?.kind === "poster" ? [] : [[layout]])], [...panels, size.element]);
  return {
    element: bar.element,
    popovers: [size],
    refresh() {
      bar.refresh();
      size.button.disabled = ctx.view.readOnly;
      if (ctx.view.readOnly) size.close();
      size.refresh();
    },
  };
}

/** theme.css with `style` as its Style section; null when it cannot be written. */
const themeWith = (ctx: ShellContext, style: DeckStyle): string | null => setThemeStyle(ctx.view.theme, style);

/** The Style panel's port over theme.css: previews render the current slide with the candidate theme; Apply is one undo step. */
function htmlStylePort(ctx: ShellContext): DeckStylePort {
  const unavailable = { kind: "swatches" as const, note: "Preview unavailable" };
  return {
    read() {
      const found = readThemeStyle(ctx.view.theme);
      return { style: { ...DEFAULT_DECK_STYLE, ...found.style }, block: found.block?.text ?? "" };
    },
    candidateBlock(style) {
      const css = themeWith(ctx, style);
      return css === null ? null : readThemeStyle(css).block?.text ?? null;
    },
    async preview(style) {
      const theme = themeWith(ctx, style);
      if (theme === null) return unavailable;
      const { html, slide } = ctx.view;
      const thumbnails = createDeckThumbnails({ deck: () => ({ html, theme, canvas: canvasOf(ctx) }), resolveAsset: ctx.options.resolveAsset, ...(ctx.options.assetOrigin ? { assetOrigin: ctx.options.assetOrigin } : {}) });
      const src = await thumbnails.thumbnail(slide);
      return src ? { kind: "image", src } : unavailable;
    },
    apply(style) {
      const css = themeWith(ctx, style);
      if (css === null) return false;
      ctx.editor.editThemeCss(css, "Apply style");
      return true;
    },
    stagePreview: (style) => ctx.editor.previewThemeCss(style === null ? null : themeWith(ctx, style)),
  };
}

/** A panel shown in the properties column in place of the properties. */
interface ShellPanel { element: HTMLElement; refresh(): void; destroy(): void }
interface PanelSpec { icon: IconName; label: string; open(onClose: () => void): ShellPanel }

/** The buttons of the panels shown in place of the properties (Poster Settings, Style): one is open at a time, and opening one closes the
    other; closing the open one shows the properties again. Read-only decks open none. */
function createPanelToggles(ctx: ShellContext, props: HTMLElement, specs: readonly PanelSpec[]): { buttons: HTMLButtonElement[]; render(): void; destroy(): void } {
  let open: { button: HTMLButtonElement; panel: ShellPanel } | undefined;
  const close = (): void => {
    if (!open) return;
    const { button, panel } = open;
    open = undefined;
    panel.destroy();
    props.hidden = false;
    button.setAttribute("aria-pressed", "false");
  };
  const buttons = specs.map((spec) => {
    const button = shellButton(spec.icon, spec.label, "dw-insert", () => {
      if (open?.button === button) return close();
      if (ctx.view.readOnly) return;
      close();
      const panel = spec.open(() => { close(); button.focus(); });
      open = { button, panel };
      props.after(panel.element);
      props.hidden = true;
      button.setAttribute("aria-pressed", "true");
    });
    button.setAttribute("aria-pressed", "false");
    return button;
  });
  return {
    buttons,
    render() {
      for (const button of buttons) button.disabled = ctx.view.readOnly;
      if (ctx.view.readOnly) close();
      open?.panel.refresh();
    },
    destroy: close,
  };
}

/** The Poster button (posters only) and the Style button, with the panels they show in the properties column. */
function createPanelButtons(ctx: ShellContext, props: HTMLElement): ReturnType<typeof createPanelToggles> {
  const style: PanelSpec = {
    icon: "droplet", label: "Style",
    open: (onClose) => mountStylePanel(htmlStylePort(ctx), { onClose, ...(ctx.options.kits ? { kits: ctx.options.kits } : {}) }),
  };
  const poster: PanelSpec = {
    icon: "gear", label: "Poster",
    open() {
      const settings = createPosterSettings(ctx);
      return { element: settings.element, refresh: settings.refresh, destroy: () => settings.element.remove() };
    },
  };
  return createPanelToggles(ctx, props, ctx.view.model?.kind === "poster" ? [poster, style] : [style]);
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
function keyActions(ctx: ShellContext, zoom: ShellZoomBar, target: ShellZoomTarget): ShellKeyActions {
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
    copy: () => copySelected(ctx),
    paste: () => pasteClipboard(ctx),
    group: () => groupSelected(ctx),
    ungroup: () => ungroupSelected(ctx),
    zoomToSelection: () => { if (target.enabled()) target.run(); },
  };
  if (ctx.view.model?.kind === "poster") { delete actions.previous; delete actions.next; } else delete actions.zoomToSelection;
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

/** The screen px Zoom to section keeps around the rect. */
const ZOOM_PADDING = 24;

/** Scrolls the viewport so the canvas point `centre` is in its middle. */
function panTo(ctx: ShellContext, centre: { x: number; y: number }): void {
  const { viewport, stage } = ctx.editor;
  const outer = viewport.getBoundingClientRect();
  const inner = stage.getBoundingClientRect();
  viewport.scrollLeft += inner.left - outer.left + centre.x * ctx.view.scale - viewport.clientWidth / 2;
  viewport.scrollTop += inner.top - outer.top + centre.y * ctx.view.scale - viewport.clientHeight / 2;
}

/** The header and section boxes of a sectioned HTML poster; null for any other deck. */
function posterBoxes(ctx: ShellContext): PosterBox[] | null {
  const layout = ctx.view.model?.kind === "poster" ? readPosterLayout(ctx.view.html, ctx.view.theme) : null;
  return layout ? [...(layout.header ? [layout.header] : []), ...layout.columns.flat()] : null;
}

/** The editor's zoom and tool, and for a poster the zoom to a rect and the visible part of the canvas, in canvas px. */
function editorSurface(ctx: ShellContext): ShellZoomSurface {
  const base: ShellZoomSurface = {
    percent: () => ctx.view.scale * 100,
    isFit: () => ctx.view.fit,
    setZoom: (next) => ctx.editor.setZoom(next === "fit" ? "fit" : next / 100),
    setTool: (tool) => ctx.editor.setTool(tool),
  };
  if (ctx.view.model?.kind !== "poster") return base;
  return {
    ...base,
    zoomToRect(rect) {
      const { viewport } = ctx.editor;
      if (rect.width <= 0 || rect.height <= 0) return;
      ctx.editor.setZoom(fitRectZoom(rect, { width: viewport.clientWidth, height: viewport.clientHeight }, ZOOM_PADDING) / 100);
      panTo(ctx, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    },
    viewport() {
      const { viewport, stage } = ctx.editor;
      const outer = viewport.getBoundingClientRect();
      const inner = stage.getBoundingClientRect();
      const scale = ctx.view.scale || 1;
      return ctx.view.model ? { left: (outer.left - inner.left) / scale, top: (outer.top - inner.top) / scale, width: viewport.clientWidth / scale, height: viewport.clientHeight / scale } : null;
    },
  };
}

/** The rect Zoom to section fits: the selected section of a sectioned poster, else the selected block; undefined for none or a talk. */
function zoomRect(ctx: ShellContext): ShellRect | undefined {
  if (ctx.view.model?.kind !== "poster") return undefined;
  const block = selectedBlock(ctx);
  if (!block) return undefined;
  return posterBoxes(ctx)?.find((box) => box.id === block.id)?.rect ?? block.rect ?? undefined;
}

/** The minimap of a poster: its canvas, its header and sections (a sectioned poster) or its blocks, and the visible part. */
function createPosterMinimap(ctx: ShellContext, surface: ShellZoomSurface): ReturnType<typeof createMinimap> {
  return createMinimap({
    page: () => (ctx.view.model?.kind === "poster" && ctx.view.html ? canvasOf(ctx) : null),
    boxes: () => posterBoxes(ctx)?.map((box) => box.rect) ?? (ctx.view.model?.slides[0]?.blocks ?? []).flatMap((block) => (block.rect ? [block.rect] : [])),
    viewport: () => surface.viewport?.() ?? null,
    panTo: (centre) => panTo(ctx, centre),
  });
}

/** Marks the stage as ruled when there are rulers and adds the rulers, the poster stage and the floating bar to it. */
function mountStageOverlays(centre: HTMLElement, rulers: HTMLElement | undefined, floating: HTMLElement, poster: HTMLElement): void {
  centre.classList.toggle("has-rulers", rulers !== undefined);
  centre.append(...(rulers ? [rulers] : []), poster, floating);
}

/** A double-click on a chart block reopens the figure editor on it. */
function bindChartReopen(ctx: ShellContext, centre: HTMLElement): void {
  centre.addEventListener("dblclick", (event) => {
    const id = event.target instanceof Element ? event.target.closest("[data-block-box]")?.getAttribute("data-block-box") : null;
    const block = id && !ctx.view.readOnly ? findDeckBlock(ctx.view.model, id) : undefined;
    if (block && readDeckChart(ctx.view.html, block)) editChart(ctx, block.id);
  });
}

interface WorkspaceParts {
  unbindKeys(): void;
  left: ReturnType<typeof createLeftPanel>;
  insert: ReturnType<typeof createHtmlInsertBar>;
  panels: ReturnType<typeof createPanelButtons>;
  poster: ReturnType<typeof createPosterStage>;
}

/** The controller of an open workspace: the editor's, with the shell's element, the saved flag and a destroy that tears down every part. */
function workspaceController(ctx: ShellContext, shell: ReturnType<typeof mountDeckShell>, state: { saved: boolean }, render: () => void, parts: WorkspaceParts): DeckWorkspaceController {
  return {
    ...ctx.editor,
    get element() { return shell.root; },
    setSaved(saved) { state.saved = saved; render(); },
    destroy() {
      parts.unbindKeys();
      parts.left.destroy();
      for (const popover of parts.insert.popovers) popover.destroy();
      parts.panels.destroy();
      parts.poster.destroy();
      ctx.editor.destroy();
      shell.destroy();
    },
  };
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
    zoom.render();
  };
  const header = createShellHeader(headerSpec(ctx, setMode));
  const props = createPropertiesPanel(ctx);
  const panels = createPanelButtons(ctx, props.element);
  const insert = createHtmlInsertBar(ctx, panels.buttons);
  const left = createLeftPanel(ctx);
  const surface = editorSurface(ctx);
  const target: ShellZoomTarget = {
    enabled: () => mode !== "code" && zoomRect(ctx) !== undefined,
    run() { const rect = zoomRect(ctx); if (rect) surface.zoomToRect?.(rect); },
  };
  const zoom = createZoomBar(surface, { section: target });
  const minimap = ctx.view.model?.kind === "poster" ? createPosterMinimap(ctx, surface) : undefined;
  const floating = createFloatingBar(ctx);
  const rulers = ctx.view.model?.kind === "poster" ? createRulers(ctx) : undefined;
  const poster = createPosterStage(ctx);
  const notes = createNotes(ctx);
  const status = createShellStatus();
  mountStageOverlays(centre, rulers?.element, floating.element, poster.element);
  if (minimap) centre.append(minimap.element);
  const shell = mountDeckShell(host, {
    format: "html", kind: ctx.view.model?.kind ?? "talk",
    header: header.element, insert: insert.element, left: left.element, stage: centre, zoom: zoom.element, props: props.element, status: status.element, notes: notes.element,
  });
  shell.root.classList.add("dsh");
  header.setMode(mode);
  const unbindKeys = bindShellKeys(shell.root, keyActions(ctx, zoom, target));
  bindChartReopen(ctx, centre);
  const onScroll = (): void => { floating.render(); rulers?.render(); poster.render(); minimap?.render(); };
  ctx.editor.viewport.addEventListener("scroll", onScroll, { passive: true });
  render = () => {
    header.setSaved(state.saved);
    insert.refresh(); left.render(); props.render(); panels.render(); zoom.render(); notes.render(); poster.render(); status.set(statusParts(ctx, state.saved));
    requestAnimationFrame(onScroll);
  };
  render();
  return workspaceController(ctx, shell, state, render, { unbindKeys, left, insert, panels, poster });
}
