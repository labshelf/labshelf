/** Routes keys while an overlay (prompt, picker, confirm or help) is open. */
import { rankFuzzy } from "@labshelf/core";

import type { InputEvent } from "../../../screen/index.js";
import { editText, textInput } from "../../textInput.js";
import { helpRows, type ConfirmOverlay, type HelpOverlay, type PickerOverlay, type PromptOverlay, type PromptPurpose } from "../../overlays.js";
import type { App } from "../app.js";
import { complete } from "./askCompletion.js";
import { submitPrompt } from "./applyAsk.js";

export function openPrompt(app: App, purpose: PromptPurpose, title: string, value: string, hint?: string, targets: string[] = []): void {
  app.overlay = { kind: "prompt", purpose, title, input: textInput(value), completions: [], targets, ...(hint ? { hint } : {}) };
}

export function handleOverlay(app: App, event: InputEvent): void {
  const overlay = app.overlay!;
  const key = event.type === "key" ? event.id : undefined;
  if (overlay.kind === "help") { return handleHelp(app, overlay, key); }
  if (overlay.kind === "confirm") { return handleConfirm(app, overlay, key); }
  if (key === "esc" || key === "C-c") {
    app.overlay = undefined;
    return;
  }
  if (overlay.kind === "picker") { return handlePicker(app, overlay, event); }
  if (key === "enter") {
    app.overlay = undefined;
    submitPrompt(app, overlay);
    return;
  }
  if (key === "tab") {
    void complete(app, overlay);
    return;
  }
  const next = editText(overlay.input, event);
  if (next) {
    overlay.input = next;
    overlay.completions = [];
  }
}

function handleHelp(app: App, overlay: HelpOverlay, key: string | undefined): void {
  const max = helpRows().length;
  if (key === "j" || key === "down") { overlay.scroll = Math.min(overlay.scroll + 1, max); }
  else if (key === "k" || key === "up") { overlay.scroll = Math.max(0, overlay.scroll - 1); }
  else if (key === "C-d" || key === "pagedown" || key === "space") { overlay.scroll = Math.min(overlay.scroll + 10, max); }
  else if (key === "C-u" || key === "pageup") { overlay.scroll = Math.max(0, overlay.scroll - 10); }
  else if (key === "esc" || key === "q" || key === "?" || key === "C-c" || key === "enter") { app.overlay = undefined; }
}

function handleConfirm(app: App, overlay: ConfirmOverlay, key: string | undefined): void {
  if (key === "y" || key === "Y" || key === "enter") {
    app.overlay = undefined;
    overlay.onYes();
  } else if (key === "n" || key === "N" || key === "esc" || key === "C-c" || key === "q") {
    app.overlay = undefined;
  }
}

function handlePicker(app: App, picker: PickerOverlay, event: InputEvent): void {
  const key = event.type === "key" ? event.id : undefined;
  if (key === "enter") {
    const item = picker.filtered[picker.index];
    app.overlay = undefined;
    if (item) { picker.onPick(item); }
    return;
  }
  if (key === "down" || key === "C-n" || key === "C-j" || key === "tab") {
    picker.index = Math.min(picker.index + 1, picker.filtered.length - 1);
    return;
  }
  if (key === "up" || key === "C-p" || key === "C-k" || key === "S-tab") {
    picker.index = Math.max(picker.index - 1, 0);
    return;
  }
  const next = editText(picker.input, event);
  if (next) {
    picker.input = next;
    picker.filtered = rankFuzzy(picker.items, next.value, (item) => `${item.label} ${item.detail ?? ""}`);
    picker.index = 0;
  }
}
