/** Edits text inline for the filter, find and search modes: every keystroke updates the live result. */
import type { InputEvent } from "../../../screen/index.js";
import { editText } from "../../textInput.js";
import type { App } from "../app.js";

export function findStep(app: App, direction: 1 | -1, from = app.listModel.cursor()): void {
  if (!app.findQuery) { return; }
  const isMatch = app.ctx.store.matcher(app.findQuery);
  const matches: number[] = [];
  app.listModel.papers().forEach((p, i) => { if (isMatch(p)) { matches.push(i); } });
  if (!matches.length) {
    app.taskStatus.notify(`No match for "${app.findQuery}"`, "warn");
    return;
  }
  const next = direction === 1
    ? matches.find((i) => i > from) ?? matches[0]!
    : [...matches].reverse().find((i) => i < from) ?? matches[matches.length - 1]!;
  app.listModel.setPaperCursor(next);
}

export function handleInline(app: App, event: InputEvent): void {
  const inline = app.inline!;
  if (event.type === "key" && (event.id === "esc" || event.id === "C-c")) {
    if (inline.purpose === "filter") { app.filter = app.filterBeforeEdit; }
    if (inline.purpose === "search") { app.historyNav.leaveSearch(); }
    app.inline = undefined;
    return;
  }
  if (event.type === "key" && event.id === "enter") {
    app.inline = undefined;
    if (inline.purpose === "search") {
      if (!inline.input.value.trim()) {
        app.historyNav.leaveSearch();
      } else {
        app.historyNav.confirmSearch();
      }
    }
    return;
  }
  if (event.type === "key" && (event.id === "down" || event.id === "C-n")) { app.listModel.move(1); return; }
  if (event.type === "key" && (event.id === "up" || event.id === "C-p")) { app.listModel.move(-1); return; }
  const next = editText(inline.input, event);
  if (!next) { return; }
  inline.input = next;
  if (inline.purpose === "filter") {
    app.filter = next.value;
  } else if (inline.purpose === "find") {
    app.findQuery = next.value;
    findStep(app, 1, app.listModel.cursor() - 1);
  } else {
    app.search = next.value;
    const state = app.listModel.cursorState();
    state.id = undefined;
    state.index = 0;
  }
}
