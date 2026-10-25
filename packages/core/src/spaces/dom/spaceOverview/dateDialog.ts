// Edits a date draft in an accessible modal over the Spaces transport.
import { el, mountOverlay } from "../../../ui/dom/index.js";
import type { SpaceDate } from "../../model/index.js";
import { parseDateDraft, type PaperPickItem } from "../../protocol/index.js";
import type { OverviewContext } from "./index.js";
import { dateFields } from "./dateFields.js";
import { paperGoalFields, projectGoalFields } from "./goalFields.js";

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
