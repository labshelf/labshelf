// Builds the positioned topics list and discussion thread area.
import { el, emptyState } from "../../../ui/dom/index.js";
import { plannedButton, plannedSearch } from "./controls.js";

const reason = "Discussions need collaboration";

export function spaceDiscussions(): HTMLElement {
  const views = ["Topics", "Decisions", "Tasks"].map((label, index) => {
    const button = plannedButton(label, reason);
    button.setAttribute("aria-pressed", String(index === 0));
    return button;
  });
  return el("div", { class: "discussions" },
    el("header", { class: "ds-heading" },
      el("div", {}, el("h2", { text: "Discussions" }),
        el("p", { text: "Discuss papers and keep decisions and tasks together." })),
      plannedButton("New topic", reason, "ls-btn ls-btn-primary")),
    el("div", { class: "ds-toolbar" },
      el("div", { role: "group", "aria-label": "Discussion views" }, ...views),
      plannedSearch("Search discussions", reason)),
    el("div", { class: "ds-layout" },
      el("section", { class: "ds-topics", "aria-label": "Topics" },
        emptyState({ text: "No topics yet.", hint: "Topics will hold conversations about this Space.", inline: true })),
      el("section", { class: "ds-detail", "aria-label": "Discussion thread" },
        emptyState({ text: "No discussion selected.", hint: "A topic's conversation, decisions and tasks will appear here." }))));
}
