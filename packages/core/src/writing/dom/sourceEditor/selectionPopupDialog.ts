// The Customize Selection Popup dialog: when the popup opens, whether a click on a token opens it, whether it suggests actions, and one switch per button of the file's language, each applied as it is changed.
import type { EditorView } from "@codemirror/view";
import { mountOverlay, renderElement } from "../../../ui/dom/index.js";
import { SELECTION_POPUP_BUTTON_INFO, listSelectionPopupButtons, type SelectionPopupPrefs, type SelectionPopupTrigger } from "../../../index.js";
import type { SourceLanguage } from "./formatting.js";

export interface SelectionPopupDialogOptions {
  language: SourceLanguage;
  prefs: SelectionPopupPrefs;
  /** Runs on each change with the whole new settings. */
  onChange(next: SelectionPopupPrefs): void;
  /** Gets the focus back when the dialog closes. */
  view?: EditorView;
}

const TRIGGERS: readonly { value: SelectionPopupTrigger; label: string }[] = [
  { value: "mouse", label: "On a mouse selection" },
  { value: "any", label: "On any selection" },
  { value: "shortcut", label: "Only with Mod+." },
  { value: "never", label: "Never" },
];

let dialogOpen = false;

function switchRow(label: string, checked: boolean, onFlip: (on: boolean) => void): HTMLElement {
  const control = renderElement("input", { type: "checkbox", role: "switch", "aria-label": label });
  control.checked = checked;
  control.addEventListener("change", () => onFlip(control.checked));
  return renderElement("label", { class: "ls-typing-row" }, renderElement("span", { class: "ls-typing-text" }, renderElement("span", { text: label })), control);
}

/** Opens the dialog; Close or Escape gives the focus back to the editor. */
export function openSelectionPopupDialog(options: SelectionPopupDialogOptions): void {
  if (dialogOpen) return;
  dialogOpen = true;
  let current: SelectionPopupPrefs = { ...options.prefs, hidden: [...options.prefs.hidden] };
  const change = (next: Partial<SelectionPopupPrefs>): void => { current = { ...current, ...next }; options.onChange(current); };
  const heading = renderElement("div", { class: "ls-dialog-title", id: "ls-selection-popup-title", text: "Customize Selection Popup" });
  const trigger = renderElement("select", { class: "ls-select", "aria-label": "Open the popup" },
    ...TRIGGERS.map((option) => renderElement("option", { value: option.value, text: option.label })));
  trigger.value = current.trigger;
  trigger.addEventListener("change", () => change({ trigger: trigger.value as SelectionPopupTrigger }));
  const buttons = listSelectionPopupButtons(options.language).map((id) => switchRow(SELECTION_POPUP_BUTTON_INFO[id].label, !current.hidden.includes(id), (on) => {
    change({ hidden: on ? current.hidden.filter((hidden) => hidden !== id) : [...current.hidden, id] });
  }));
  const close = renderElement("button", { type: "button", class: "ls-btn", text: "Close" });
  const dialog = renderElement("div", { class: "ls-dialog ls-typing-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": heading.id },
    renderElement("div", { class: "ls-dialog-head" }, heading),
    renderElement("div", { class: "ls-typing-rows" },
      renderElement("label", { class: "ls-typing-row" }, renderElement("span", { class: "ls-typing-text" }, renderElement("span", { text: "Open the popup" })), trigger),
      switchRow("Also on a click on a citation, reference or drawing", current.onClick, (on) => change({ onClick: on })),
      switchRow("Suggest actions for what is selected", current.contextual, (on) => change({ contextual: on })),
      ...buttons),
    renderElement("div", { class: "ls-dialog-actions" }, close));
  const dismiss = (): void => { dialogOpen = false; overlay.close(); options.view?.focus(); };
  const overlay = mountOverlay(dialog, dismiss);
  close.addEventListener("click", dismiss);
  close.focus();
}
