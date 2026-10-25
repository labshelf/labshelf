// Builds the labelled inputs for a date draft.
import { el } from "../../../ui/dom/index.js";
import type { SpaceDate } from "../../model/index.js";
export function dateFields(date?: SpaceDate) {
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
