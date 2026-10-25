// Builds the positioned discovery feed with alerts and Watch cards.
import { el, emptyState } from "../../../ui/dom/index.js";
import { plannedButton, plannedSearch } from "./controls.js";

const reason = "Discover needs a connected discovery service";

export function spaceDiscover(): HTMLElement {
  const filters = ["All", "Gaps", "For this project", "Later versions"].map((label, index) => {
    const button = plannedButton(label, reason, "dc-chip");
    button.setAttribute("aria-pressed", String(index === 0));
    return button;
  });
  return el("div", { class: "dc-grid" },
    el("div", { class: "dc-main" },
      el("div", { class: "dc-search" }, plannedSearch("Search this Space's feed", reason)),
      el("div", { class: "dc-chips", role: "group", "aria-label": "Discover filters" }, ...filters),
      el("section", { class: "dc-feed", "aria-label": "Suggested papers" }, emptyState({
        text: "No suggestions yet.", hint: "Discover will suggest papers from this Space's papers, citations and authors.",
      }))),
    el("aside", { class: "dc-side", "aria-label": "Discovery services" },
      card("arXiv alerts", "No alerts for this Space.", "Alerts will follow categories and keywords for this Space.",
        "Set up alerts", "arXiv alerts need a connected alert service"),
      card("Watch", "No Watch results yet.", "Watch will check papers for later versions, retractions and errata.",
        "Check papers", "Watch needs connected paper lookup services")));
}

function card(title: string, text: string, hint: string, label: string, missing: string): HTMLElement {
  return el("section", { class: "dc-card", "aria-label": title },
    el("h2", { class: "dc-card-head", text: title }), emptyState({ text, hint, inline: true }),
    plannedButton(label, missing));
}
