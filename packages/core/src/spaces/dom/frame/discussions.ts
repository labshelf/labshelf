// Builds the positioned topics list and discussion thread area.
import { renderElement, renderEmptyNotice } from "../../../ui/dom/index.js";
import { renderPlannedButton, renderPlannedSearch } from "./controls.js";

const reason = "Discussions need collaboration";

export function renderSpaceDiscussions(): HTMLElement {
  const views = ["Topics", "Decisions", "Tasks"].map((label, index) => {
    const button = renderPlannedButton(label, reason);
    button.setAttribute("aria-pressed", String(index === 0));
    return button;
  });
  return renderElement("div", { class: "discussions" },
    renderElement("header", { class: "ds-heading" },
      renderElement("div", {}, renderElement("h2", { text: "Discussions" }),
        renderElement("p", { text: "Discuss papers and keep decisions and tasks together." })),
      renderPlannedButton("New topic", reason, "ls-btn ls-btn-ghost")),
    renderElement("div", { class: "ds-toolbar" },
      renderElement("div", { role: "group", "aria-label": "Discussion views" }, ...views),
      renderPlannedSearch("Search discussions", reason)),
    renderElement("div", { class: "ds-layout" },
      renderElement("section", { class: "ds-topics", "aria-label": "Topics" },
        renderEmptyNotice({ text: "No topics yet.", hint: "Topics will hold conversations about this Space.", inline: true })),
      renderElement("section", { class: "ds-detail", "aria-label": "Discussion thread" },
        renderEmptyNotice({ text: "No discussion selected.", hint: "A topic's conversation, decisions and tasks will appear here." }))));
}
