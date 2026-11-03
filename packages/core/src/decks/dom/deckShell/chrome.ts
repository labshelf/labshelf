// The deck workspace's header (title, save state, Preview or Present, Export and the code toggle), its insert bar (undo, the block
// kinds, Layout, Theme and Size) and its status bar.
import { renderElement, renderIcon, showMenu, type IconName, type MenuEntry } from "../../../ui/dom/index.js";
import { applyDeckEdit } from "../../deckEdit.js";
import { createSizePopover } from "../sizePicker.js";
import { createThemePopover, type ToolbarPopover } from "../themePanel.js";
import { createInsertBar, type InsertItem } from "../workspace/index.js";
import { SLIDE_LAYOUTS, insertBlock, newSlide } from "./actions.js";
import type { ShellContext } from "./types.js";

function headerButton(icon: IconName, label: string, run: (button: HTMLButtonElement) => void, extra = ""): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: `dw-header-button ${extra}`.trim(), title: label, html: renderIcon(icon) });
  button.append(renderElement("span", { text: label }));
  button.addEventListener("click", () => run(button));
  return button;
}

export interface ShellHeader { element: HTMLElement; setSaved(saved: boolean): void; setCode(open: boolean): void }

export function createShellHeader(ctx: ShellContext, toggleCode: () => void): ShellHeader {
  const { commands = {} } = ctx.options;
  const poster = ctx.view.model?.kind === "poster";
  const saved = renderElement("span", { class: "dsh-saved", "data-saved": "true", text: "Saved" });
  const exports: MenuEntry[] = [
    ...(commands.exportPdf ? [{ label: "PDF", icon: "file-text" as const, onSelect: () => commands.exportPdf!() }] : []),
    ...(commands.exportHtml ? [{ label: "HTML file", icon: "code" as const, onSelect: () => commands.exportHtml!() }] : []),
    ...(commands.shareLink ? [{ label: "Share link", icon: "link" as const, onSelect: () => commands.shareLink!() }] : []),
  ];
  const show = poster ? commands.preview : commands.present;
  const code = renderElement("button", { type: "button", class: "dw-header-button dsh-code", title: "Show the HTML source", "aria-label": "HTML source", "aria-pressed": "false", html: renderIcon("code") });
  code.addEventListener("click", toggleCode);
  const element = renderElement("header", { class: "dw-header dsh-header" },
    renderElement("span", { class: "dw-title", text: ctx.options.title }), renderElement("span", { class: "dw-badge", text: poster ? "Poster" : "Talk" }),
    renderElement("span", { class: "dw-spacer" }), saved,
    ...(show ? [headerButton(poster ? "eye" : "play", poster ? "Preview" : "Present", () => show())] : []),
    ...(exports.length > 0 ? [headerButton("download", "Export", (button) => showMenu(button, exports), "dw-primary dsh-export")] : []),
    code);
  return {
    element,
    setSaved(next) { saved.dataset["saved"] = String(next); saved.textContent = next ? "Saved" : "Unsaved changes"; },
    setCode(open) { code.setAttribute("aria-pressed", String(open)); },
  };
}

export interface ShellInsertBar { element: HTMLElement; refresh(): void; popovers: ToolbarPopover[] }

export function createShellInsertBar(ctx: ShellContext): ShellInsertBar {
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
      for (const popover of [theme, size]) { popover.button.disabled = ctx.view.readOnly; popover.refresh(); }
    },
  };
}

export interface ShellStatus { element: HTMLElement; render(saved: boolean): void }

/** The status bar: where the editor is, the gesture hint, and the save state or the deck's problems. */
export function createShellStatus(ctx: ShellContext): ShellStatus {
  const left = renderElement("span", { class: "dw-status-left" });
  const hint = renderElement("span", { class: "dsh-hint", text: "Drag to move · Double-click to edit text" });
  const right = renderElement("span", { class: "dsh-status-right" });
  const element = renderElement("footer", { class: "dw-status dsh-status" }, left, renderElement("span", { class: "dw-spacer" }), hint, renderElement("span", { class: "dw-spacer" }), right);
  return {
    element,
    render(saved) {
      const { model, slide, readOnly, errors, notice } = ctx.view;
      const size = model?.size ? `${model.size.w} × ${model.size.h} ${model.size.unit}` : "";
      left.textContent = model?.kind === "poster" ? `Poster · ${size}` : `Slide ${slide + 1} of ${model?.slides.length ?? 0} · ${size}`;
      right.dataset["state"] = readOnly || notice ? "problem" : saved ? "saved" : "dirty";
      right.innerHTML = readOnly || notice ? "" : renderIcon(saved ? "check" : "edit");
      right.append(renderElement("span", { text: readOnly ? `This deck has errors and opens read-only: ${errors.join("; ")}` : notice || (saved ? "All changes saved" : "Unsaved changes") }));
    },
  };
}
