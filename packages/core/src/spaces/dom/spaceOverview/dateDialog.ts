// Edits a date draft in an accessible modal over the Spaces transport.
import { el, mountOverlay } from "../../../ui/dom/index.js";
import type { SpaceDate } from "../../model/index.js";
import { parseDateDraft, type PaperPickItem } from "../../protocol/index.js";
import type { OverviewContext } from "./index.js";
import type { SpaceProjectInfo } from "../../viewModel/index.js";

function paperGoalFields(items: readonly PaperPickItem[], selected: ReadonlySet<string>): HTMLElement {
  const group = el("fieldset", {}, el("legend", { text: "Papers" }));
  const found = new Set(items.map(p => p.id));
  for (const p of [...items, ...[...selected].filter(id => !found.has(id)).map(id => ({ id, title: `${id} — Not in your Library` }))]) {
    const box = el("input", { type: "checkbox", name: "paperIds", value: p.id });
    box.checked = selected.has(p.id);
    group.append(el("label", {}, box, p.title));
  }
  if (!items.length && !selected.size) group.append(el("p", { text: "No papers in your Library." }));
  return group;
}
function projectGoalFields(items: readonly SpaceProjectInfo[], selected?: string): HTMLElement {
  const select = el("select", { class: "ls-input", name: "projectId", tabindex: "0" }, el("option", { value: "", text: "Choose a project" }));
  for (const p of items) select.append(el("option", { value: p.projectId, text: p.available ? p.title : `${p.title} — Not on this device` }));
  if (selected && !items.some(p => p.projectId === selected)) select.append(el("option", { value: selected, text: `${selected} — Not on this device` }));
  select.value = selected ?? "";
  return el("label", {}, "Project", select);
}

function dateFields(date?: SpaceDate) {
  const kind = el("select", { class: "ls-input", name: "kind", tabindex: "0" });
  for (const [value, label] of [["task", "Task"], ["deadline", "Deadline"], ["read", "Reading goal"], ["project", "Project goal"]] as const) {
    kind.append(el("option", { value, text: label }));
  }
  kind.value = date?.kind ?? "task";
  const title = el("input", { class: "ls-input", name: "title", required: true, value: date?.title ?? "" });
  const day = el("input", { class: "ls-input", name: "date", type: "date", required: true, value: date?.date ?? "" });
  const body = el("div", { class: "sp-date-fields" },
    el("label", {}, "Kind", kind), el("label", {}, "Title", title), el("label", {}, "Date", day));
  return { body, kind, title, day };
}

export function dateDialog(ctx: OverviewContext, date?: SpaceDate): () => void {
  const fields = dateFields(date);
  const goals = el("div", { class: "sp-goal-fields" });
  const error = el("p", { role: "alert" });
  const form = el("form", { class: "ls-dialog sp-date-dialog", role: "dialog", "aria-modal": "true", "aria-label": date ? "Edit date" : "Add date" },
    el("h2", { text: date ? "Edit date" : "Add date" }), fields.body, goals, error);
  const selected = new Set(date?.kind === "read" ? date.paperIds : []);
  let projectId = date?.kind === "project" ? date.projectId : undefined;
  let papers: readonly PaperPickItem[] = [];
  const paint = (): void => {
    goals.replaceChildren();
    if (fields.kind.value === "read") goals.append(paperGoalFields(papers, selected));
    if (fields.kind.value === "project") goals.append(projectGoalFields(ctx.data.projects, projectId));
  };
  goals.addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    if (input.name === "paperIds") { if (input.checked) selected.add(input.value); else selected.delete(input.value); }
    if (input.name === "projectId") projectId = input.value || undefined;
  });
  fields.kind.addEventListener("change", paint);
  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type === "papers") { papers = message.items; paint(); }
  });
  const overlay = mountOverlay(form, () => unsubscribe());
  const close = (): void => { unsubscribe(); overlay.close(); };
  addActions(form, close);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const draft = parseDateDraft({ kind: fields.kind.value, title: fields.title.value.trim(), date: fields.day.value,
      done: date?.kind === "task" ? date.done : false, paperIds: [...selected], projectId });
    if (!draft) { error.textContent = "Enter a title and a valid date."; return; }
    ctx.end.post(date ? { type: "updateDate", id: ctx.data.space.id, dateId: date.id, date: draft }
      : { type: "addDate", id: ctx.data.space.id, date: draft });
    close();
  });
  paint(); fields.title.focus(); ctx.end.post({ type: "listPapers" });
  return close;
}
function addActions(form: HTMLElement, close: () => void): void {
  const cancel = el("button", { class: "ls-btn", type: "button", text: "Cancel" });
  cancel.addEventListener("click", close);
  form.append(el("div", { class: "ls-dialog-actions" }, cancel,
    el("button", { class: "ls-btn ls-btn-primary", type: "submit", text: "Save" })));
}
