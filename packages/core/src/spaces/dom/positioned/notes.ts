// Builds the positioned Space notes and Paper notes groups.
import { el, emptyState } from "../../../ui/dom/index.js";
import { plannedButton } from "./controls.js";

export function spaceNotes(): HTMLElement {
  return el("div", { class: "nt-notes" },
    el("div", { class: "nt-bar" },
      el("p", { text: "Keep ideas, comparisons and quotes alongside this Space's papers." }),
      plannedButton("New note", "Notes need a connected note editor", "ls-btn ls-btn-ghost")),
    group("Space notes", "No Space notes yet.", "Space notes will keep meeting notes and ideas together."),
    group("Paper notes", "No Paper notes yet.", "Paper notes will keep your notes beside their paper."));
}

function group(title: string, text: string, hint: string): HTMLElement {
  return el("section", { class: "nt-group", "aria-label": title },
    el("h2", { text: title }), emptyState({ text, hint, inline: true }));
}
