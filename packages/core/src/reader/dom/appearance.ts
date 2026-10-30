// Offers the appearance popover (scroll mode, spreads, page theme and custom themes) and applies the view modes to pdf.js.
import {
  PDF_THEMES, SCROLL_MODES, SPREAD_MODES, customThemeIdOf, toCustomThemeRef,
  type CustomReaderTheme, type PdfTheme, type ReaderView, type ScrollMode, type SpreadMode,
} from "../../model/index.js";
import { findPagePreset } from "../index.js";
import { renderIcon, type IconName } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { renderReaderIconButton, updatePopoverOpen } from "./elements.js";
import type { ReaderContext } from "./readerSession.js";
import type { ThemeController } from "./theme.js";

const SCROLL_PDFJS: Record<ScrollMode, "VERTICAL" | "HORIZONTAL" | "WRAPPED"> = { vertical: "VERTICAL", horizontal: "HORIZONTAL", wrapped: "WRAPPED" };
const SPREAD_PDFJS: Record<SpreadMode, "NONE" | "ODD" | "EVEN"> = { none: "NONE", odd: "ODD", even: "EVEN" };

/** Holds the paper's scroll and spread mode, applies them to pdf.js and reports a change to the host. */
export class ViewModes {
  view: ReaderView = { scroll: "vertical", spread: "none" };

  constructor(private readonly ctx: ReaderContext) {}

  /** Applies a stored view without reporting it; init calls it before the reading position is restored. */
  restore(view: ReaderView | null): void {
    if (view) { this.apply(view); }
  }

  /** Applies a mode the reader picked and has the host remember it for the paper. */
  set(change: Partial<ReaderView>): void {
    const view = { ...this.view, ...change };
    if (view.scroll === this.view.scroll && view.spread === this.view.spread) { return; }
    this.apply(view);
    this.ctx.host.post({ command: "setViewMode", scroll: view.scroll, spread: view.spread });
  }

  private apply(view: ReaderView): void {
    this.view = view;
    const { pdfViewer, viewerLib } = this.ctx;
    pdfViewer.scrollMode = viewerLib.ScrollMode[SCROLL_PDFJS[view.scroll]];
    pdfViewer.spreadMode = viewerLib.SpreadMode[SPREAD_PDFJS[view.spread]];
  }
}

const SCROLL_CHOICES: Record<ScrollMode, { icon: IconName; label: string }> = {
  vertical: { icon: "scroll-vertical", label: "Vertical scrolling" },
  horizontal: { icon: "scroll-horizontal", label: "Horizontal scrolling" },
  wrapped: { icon: "scroll-wrapped", label: "Wrapped scrolling" },
};

const SPREAD_CHOICES: Record<SpreadMode, { icon: IconName; label: string }> = {
  none: { icon: "spread-none", label: "No spreads" },
  odd: { icon: "spread-odd", label: "Odd spreads" },
  even: { icon: "spread-even", label: "Even spreads" },
};

const THEME_LABELS: Record<PdfTheme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
  sepia: "Sepia",
  "high-contrast": "High contrast",
};

/** Redraws the open popover; one listener per theme controller, whatever the number of times the popover opens. */
let redrawOpen: (() => void) | null = null;
const listening = new WeakSet<ThemeController>();

export interface AppearanceDeps {
  ctx: ReaderContext;
  theme: ThemeController;
  modes: ViewModes;
}

/**
 * Opens the appearance popover under `anchor`. It stays open while the reader picks modes and themes, and redraws when the
 * host answers with a new theme or theme list. The preview, whose pages follow its own Dark PDF switch, shows no themes.
 */
export function openAppearancePopover(anchor: HTMLElement, deps: AppearanceDeps): void {
  const root = renderElement("div", { class: "rd-appearance", "aria-label": "Appearance" });
  let editing: CustomReaderTheme | "new" | null = null;
  const render = (): void => {
    root.replaceChildren(...renderSections(deps, editing, (next) => { editing = next; render(); }));
  };
  redrawOpen = () => { if (root.isConnected && editing === null) { render(); } };
  if (!listening.has(deps.theme)) {
    listening.add(deps.theme);
    deps.theme.onThemesChange(() => redrawOpen?.());
  }
  render();
  updatePopoverOpen(anchor, root, "below");
}

function renderSections(
  deps: AppearanceDeps,
  editing: CustomReaderTheme | "new" | null,
  setEditing: (next: CustomReaderTheme | "new" | null) => void,
): HTMLElement[] {
  const { ctx, modes } = deps;
  const rows = [
    renderSegmented("Scroll", SCROLL_MODES, SCROLL_CHOICES, modes.view.scroll, (scroll) => modes.set({ scroll })),
    renderSegmented("Spreads", SPREAD_MODES, SPREAD_CHOICES, modes.view.spread, (spread) => modes.set({ spread })),
  ];
  if (ctx.boot.preview) { return rows; }
  const themes = editing === null ? renderThemeGrid(deps, setEditing) : renderThemeEditor(deps, editing, setEditing);
  return [...rows, renderElement("div", { class: "rd-menu-sep" }), renderElement("div", { class: "rd-appearance-title" }, "Themes"), themes];
}

function renderSegmented<T extends string>(
  title: string,
  values: readonly T[],
  choices: Record<T, { icon: IconName; label: string }>,
  current: T,
  pick: (value: T) => void,
): HTMLElement {
  const group = renderElement("div", { class: "rd-segmented", role: "group", "aria-label": title });
  for (const value of values) {
    const button = renderReaderIconButton(renderIcon(choices[value].icon), choices[value].label, "rd-segment");
    button.setAttribute("aria-pressed", String(value === current));
    button.addEventListener("click", () => {
      pick(value);
      for (const b of group.querySelectorAll("button")) { b.setAttribute("aria-pressed", String(b === button)); }
    });
    group.append(button);
  }
  return renderElement("div", { class: "rd-appearance-row" }, renderElement("span", { class: "rd-appearance-label" }, title), group);
}

function renderThemeTile(label: string, page: string, ink: string, checked: boolean): HTMLButtonElement {
  const tile = renderElement("button", { class: "rd-theme-tile", type: "button", role: "radio", "aria-checked": String(checked), title: label }, label);
  tile.style.background = page;
  tile.style.color = ink;
  return tile;
}

function renderThemeGrid(deps: AppearanceDeps, setEditing: (next: CustomReaderTheme | "new") => void): HTMLElement {
  const { ctx, theme } = deps;
  const grid = renderElement("div", { class: "rd-theme-grid", role: "radiogroup", "aria-label": "Page theme" });
  const select = (ref: string): void => ctx.host.post({ command: "selectTheme", theme: ref });
  for (const value of PDF_THEMES) {
    // Auto shows what it resolves to right now.
    const preset = findPagePreset(value === "auto" ? theme.effective : value);
    const tile = renderThemeTile(THEME_LABELS[value], preset.bg, preset.text, theme.preference === value);
    tile.addEventListener("click", () => select(value));
    grid.append(tile);
  }
  const selectedId = customThemeIdOf(theme.preference);
  for (const custom of theme.customThemes) {
    const tile = renderThemeTile(custom.name, custom.page, custom.ink, custom.id === selectedId);
    tile.addEventListener("click", () => select(toCustomThemeRef(custom.id)));
    const edit = renderElement("span", { class: "rd-theme-edit", role: "button", tabindex: "0", title: `Edit ${custom.name}`, "aria-label": `Edit ${custom.name}`, html: renderIcon("edit") });
    const openEditor = (e: Event): void => { e.stopPropagation(); setEditing(custom); };
    edit.addEventListener("click", openEditor);
    edit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor(e); } });
    tile.addEventListener("contextmenu", (e) => { e.preventDefault(); openEditor(e); });
    grid.append(renderElement("div", { class: "rd-theme-cell" }, tile, edit));
  }
  const add = renderElement("button", { class: "rd-theme-tile rd-theme-add", type: "button", title: "New theme", "aria-label": "New theme", html: renderIcon("plus") });
  add.addEventListener("click", () => setEditing("new"));
  grid.append(add);
  return grid;
}

function renderThemeEditor(
  deps: AppearanceDeps,
  editing: CustomReaderTheme | "new",
  setEditing: (next: null) => void,
): HTMLElement {
  const { ctx, theme } = deps;
  const start = editing === "new" ? { name: "", page: theme.colors.bg, ink: theme.colors.text } : editing;
  const name = renderElement("input", { class: "rd-theme-name", type: "text", value: start.name, placeholder: "Theme name", maxlength: "40", "aria-label": "Theme name" });
  const page = renderElement("input", { type: "color", value: start.page, "aria-label": "Page colour" });
  const ink = renderElement("input", { type: "color", value: start.ink, "aria-label": "Text colour" });
  const preview = renderThemeTile(start.name || "Preview", start.page, start.ink, false);
  preview.disabled = true;
  const save = renderElement("button", { class: "rd-btn-text rd-btn-primary", type: "button" }, "Save");
  const sync = (): void => {
    preview.style.background = page.value;
    preview.style.color = ink.value;
    preview.textContent = name.value.trim() || "Preview";
    save.disabled = name.value.trim().length === 0;
  };
  for (const input of [name, page, ink]) { input.addEventListener("input", sync); }
  sync();
  save.addEventListener("click", () => {
    const fields = { name: name.value.trim(), page: page.value, ink: ink.value };
    ctx.host.post({ command: "saveCustomTheme", theme: editing === "new" ? fields : { id: editing.id, ...fields } });
    setEditing(null);
  });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter" && !save.disabled) { save.click(); } });
  const actions = renderEditorActions(ctx, editing, save, () => setEditing(null));
  queueMicrotask(() => name.focus({ preventScroll: true }));
  return renderElement(
    "div",
    { class: "rd-theme-editor" },
    name,
    renderElement("div", { class: "rd-theme-editor-colours" },
      renderElement("label", {}, page, "Page"),
      renderElement("label", {}, ink, "Text"),
      preview,
    ),
    actions,
  );
}

/** Delete (for an existing theme), Cancel and Save, in that order. */
function renderEditorActions(ctx: ReaderContext, editing: CustomReaderTheme | "new", save: HTMLButtonElement, close: () => void): HTMLElement {
  const cancel = renderElement("button", { class: "rd-btn-text", type: "button" }, "Cancel");
  cancel.addEventListener("click", close);
  const actions = renderElement("div", { class: "rd-theme-editor-actions" });
  if (editing !== "new") {
    const remove = renderElement("button", { class: "rd-btn-text rd-btn-danger", type: "button" }, "Delete");
    remove.addEventListener("click", () => {
      ctx.host.post({ command: "deleteCustomTheme", id: editing.id });
      close();
    });
    actions.append(remove);
  }
  actions.append(renderElement("span", { class: "rd-spacer" }), cancel, save);
  return actions;
}
