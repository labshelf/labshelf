// Builds the paper and project selectors for a date goal.
import { el } from "../../../ui/dom/index.js";
import type { PaperPickItem } from "../../protocol/index.js";
import type { SpaceProjectInfo } from "../../viewModel/index.js";
export function paperGoalFields(items: readonly PaperPickItem[], selected: ReadonlySet<string>): HTMLElement {
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
export function projectGoalFields(items: readonly SpaceProjectInfo[], selected?: string): HTMLElement {
  const select = el("select", { class: "ls-input", name: "projectId", tabindex: "0" }, el("option", { value: "", text: "Choose a project" }));
  for (const p of items) select.append(el("option", { value: p.projectId, text: p.available ? p.title : `${p.title} — Not on this device` }));
  if (selected && !items.some(p => p.projectId === selected)) select.append(el("option", { value: selected, text: `${selected} — Not on this device` }));
  select.value = selected ?? "";
  return el("label", {}, "Project", select);
}
