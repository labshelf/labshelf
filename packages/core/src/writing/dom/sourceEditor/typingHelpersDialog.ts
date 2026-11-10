// The Customize Shortcuts dialog: one switch per typing helper of the file's language, each applied as it is flipped.
import type { EditorView } from "@codemirror/view";
import { mountOverlay, renderElement } from "../../../ui/dom/index.js";
import { TYPING_HELPER_INFO, listTypingHelpers, type TypingHelpers } from "../../../index.js";
import type { SourceLanguage } from "./formatting.js";

export interface TypingHelpersDialogOptions {
  language: SourceLanguage;
  helpers: TypingHelpers;
  /** Runs on each flip with every helper's new state. */
  onChange(next: TypingHelpers): void;
  /** Opens the Keyboard Shortcuts dialog; without it the dialog offers no link to it. */
  showShortcuts?(): void;
  /** Gets the focus back when the dialog closes. */
  view?: EditorView;
}

let dialogOpen = false;

/** Opens the dialog; Close or Escape gives the focus back to the editor. */
export function openTypingHelpersDialog(options: TypingHelpersDialogOptions): void {
  if (dialogOpen) return;
  dialogOpen = true;
  let current: TypingHelpers = { ...options.helpers };
  const heading = renderElement("div", { class: "ls-dialog-title", id: "ls-typing-title", text: "Customize Shortcuts" });
  const rows = listTypingHelpers(options.language).map((id) => {
    const info = TYPING_HELPER_INFO[id];
    const control = renderElement("input", { type: "checkbox", role: "switch", "aria-label": info.label });
    control.checked = current[id];
    control.addEventListener("change", () => {
      current = { ...current, [id]: control.checked };
      options.onChange(current);
    });
    return renderElement("label", { class: "ls-typing-row" },
      renderElement("span", { class: "ls-typing-text" },
        renderElement("span", { text: info.label }),
        renderElement("code", { class: "ls-typing-example", text: info.examples[options.language] ?? "" })),
      control);
  });
  const close = renderElement("button", { type: "button", class: "ls-btn", text: "Close" });
  const shortcuts = options.showShortcuts ? renderElement("button", { type: "button", class: "ls-btn", text: "Keyboard Shortcuts" }) : null;
  const dialog = renderElement("div", { class: "ls-dialog ls-typing-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": heading.id },
    renderElement("div", { class: "ls-dialog-head" }, heading),
    renderElement("div", { class: "ls-typing-rows" }, ...rows),
    renderElement("div", { class: "ls-dialog-actions" }, shortcuts, close));
  const dismiss = (): void => { dialogOpen = false; overlay.close(); options.view?.focus(); };
  const overlay = mountOverlay(dialog, dismiss);
  close.addEventListener("click", dismiss);
  shortcuts?.addEventListener("click", () => { dismiss(); options.showShortcuts?.(); });
  close.focus();
}
