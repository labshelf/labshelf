// The HTML deck's shell parts: the header spec (Talk or Poster, Visual and Code, saved, Present or Preview, the exports), the insert
// bar (undo, the block kinds, New slide, Theme and Size) and the status parts (where the editor is, the hint, saved or problems).
import { renderIcon, type IconName } from "../../../../ui/dom/index.js";
import { applyDeckEdit } from "../../../deckEdit.js";
import { createSizePopover } from "../../sizePicker.js";
import { createThemePopover, type ToolbarPopover } from "../../themePanel.js";
import { createInsertBar } from "../insertBar.js";
import type { DeckShellMode, InsertItem, ShellHeaderSpec, ShellStatusParts } from "../types.js";
import { SLIDE_LAYOUTS, insertBlock, newSlide } from "./actions.js";
import type { ShellContext } from "./types.js";

/** The header of an HTML deck; `onMode` switches between the visual editor and the HTML source. */
export function headerSpec(ctx: ShellContext, onMode: (mode: DeckShellMode) => void): ShellHeaderSpec {
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

export interface HtmlInsertBar { element: HTMLElement; refresh(): void; popovers: ToolbarPopover[] }

export function createHtmlInsertBar(ctx: ShellContext): HtmlInsertBar {
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
export function statusParts(ctx: ShellContext, saved: boolean): ShellStatusParts {
  const { model, slide, readOnly, errors, notice } = ctx.view;
  const size = model?.size ? `${model.size.w} × ${model.size.h} ${model.size.unit}` : "";
  const problem = readOnly ? `This deck has errors and opens read-only: ${errors.join("; ")}` : notice;
  return {
    left: model?.kind === "poster" ? `Poster · ${size}` : `Slide ${slide + 1} of ${model?.slides.length ?? 0} · ${size}`,
    hint: "Drag to move · Double-click to edit text",
    state: problem ? { tone: "problem", text: problem } : { tone: saved ? "saved" : "dirty", text: saved ? "All changes saved" : "Unsaved changes" },
  };
}
