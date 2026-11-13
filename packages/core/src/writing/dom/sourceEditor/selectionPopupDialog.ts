// The selection popup's shared parts: its open state and edit (below the dialog), and the Customize dialog of a text bubble (the source editor's selection popup, the notes' bubble): when it opens on a selection, whether a click opens it, whether it suggests actions, and one switch per hideable button under its group's heading, each applied as it is changed.
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { mountOverlay, renderElement } from "../../../ui/dom/index.js";
import type { SelectionPopupPrefs, SelectionPopupTrigger } from "../../../index.js";
import { reviewEdit } from "./review.js";

/** Buttons the user can hide, under one heading (Selection, Insert). */
export interface PopupButtonGroup {
  heading: string;
  buttons: readonly { id: string; label: string }[];
}

export interface SelectionPopupDialogOptions {
  /** "Customize Selection Popup" when absent. */
  title?: string;
  prefs: SelectionPopupPrefs;
  groups: readonly PopupButtonGroup[];
  /** Runs on each change with the whole new settings. */
  onChange(next: SelectionPopupPrefs): void;
  /** Gets the focus back when the dialog closes. */
  view?: { focus(): void };
}

const TRIGGERS: readonly { value: SelectionPopupTrigger; label: string }[] = [
  { value: "mouse", label: "On a mouse selection" },
  { value: "any", label: "On any selection" },
  { value: "never", label: "Never" },
];

let dialogOpen = false;

function settingRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return renderElement("label", { class: "ls-typing-row" },
    renderElement("span", { class: "ls-typing-text" }, renderElement("span", { text: label }), ...(hint ? [renderElement("span", { class: "ls-typing-example", text: hint })] : [])),
    control);
}

function switchRow(label: string, checked: boolean, onFlip: (on: boolean) => void, hint?: string): HTMLElement {
  const control = renderElement("input", { type: "checkbox", role: "switch", "aria-label": label });
  control.checked = checked;
  control.addEventListener("change", () => onFlip(control.checked));
  return settingRow(label, control, hint);
}

/** Opens the dialog; Close or Escape gives the focus back to the editor. */
export function openSelectionPopupDialog(options: SelectionPopupDialogOptions): void {
  if (dialogOpen) return;
  dialogOpen = true;
  let current: SelectionPopupPrefs = { ...options.prefs, hidden: [...options.prefs.hidden] };
  const change = (next: Partial<SelectionPopupPrefs>): void => { current = { ...current, ...next }; options.onChange(current); };
  const heading = renderElement("div", { class: "ls-dialog-title", id: "ls-selection-popup-title", text: options.title ?? "Customize Selection Popup" });
  const trigger = renderElement("select", { class: "ls-select", "aria-label": "When text is selected" },
    ...TRIGGERS.map((option) => renderElement("option", { value: option.value, text: option.label })));
  trigger.value = current.trigger;
  trigger.addEventListener("change", () => change({ trigger: trigger.value as SelectionPopupTrigger }));
  const groups = options.groups.filter((group) => group.buttons.length > 0).flatMap((group) => [
    renderElement("h3", { class: "ls-typing-heading", text: group.heading }),
    ...group.buttons.map(({ id, label }) => switchRow(label, !current.hidden.includes(id), (on) => {
      change({ hidden: on ? current.hidden.filter((hidden) => hidden !== id) : [...current.hidden, id] });
    })),
  ]);
  const close = renderElement("button", { type: "button", class: "ls-btn", text: "Close" });
  const dialog = renderElement("div", { class: "ls-dialog ls-typing-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": heading.id },
    renderElement("div", { class: "ls-dialog-head" }, heading),
    renderElement("div", { class: "ls-typing-rows" },
      settingRow("When text is selected", trigger),
      switchRow("On a click", current.onClick, (on) => change({ onClick: on }), "Inserts at the cursor, or acts on the citation or reference clicked"),
      switchRow("Suggest actions for what is selected", current.contextual, (on) => change({ contextual: on })),
      ...groups),
    renderElement("div", { class: "ls-dialog-actions" }, close));
  const dismiss = (): void => { dialogOpen = false; overlay.close(); options.view?.focus(); };
  const overlay = mountOverlay(dialog, dismiss);
  close.addEventListener("click", dismiss);
  close.focus();
}

// The state of the selection popup of the source editor: where it is open and in which mode, the effects that open and close it, and the edit
// every action of it dispatches (which closes it).
export interface PopupState {
  from: number;
  to: number;
  /** selection: on selected text; token: a click on a citation, reference or drawing, its actions; click: a click elsewhere, insertions at the cursor. */
  mode: "selection" | "token" | "click";
}

export const openPopup = StateEffect.define<PopupState>();
export const closePopup = StateEffect.define<null>();
/** Marks the popup's own edits and moves, which close it without counting as the user's selection change. */
export const popupField = StateField.define<PopupState | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(openPopup)) return effect.value;
      if (effect.is(closePopup)) return null;
    }
    if (value && (tr.docChanged || tr.selection)) return null;
    return value;
  },
});

export function dispatchEdit(view: EditorView, changes: { from: number; to: number; insert: string }, selection?: EditorSelection | { anchor: number; head?: number }): void {
  view.dispatch({ changes, ...(selection && { selection }), effects: closePopup.of(null), scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true) });
  view.focus();
}
