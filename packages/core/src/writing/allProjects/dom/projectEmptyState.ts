// Builds what the project list shows instead of rows: no match for the query, or an empty place with its way out.
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import type { ProjectPlace } from "../projectRow.js";

export interface EmptyStateOptions {
  place: ProjectPlace;
  query: string;
  onClearQuery: () => void;
  onNew: (anchor: HTMLElement) => void;
}

const EMPTY_TEXT: Record<ProjectPlace, string> = { projects: "No projects yet", archived: "No archived projects", trash: "Trash is empty" };

export function buildProjectEmptyState(o: EmptyStateOptions): HTMLElement {
  const box = el("div", { class: "ls-empty" });
  if (o.query.trim()) {
    box.innerHTML = `<div class="ls-empty-icon">${icon("search")}</div><div class="ls-empty-text">No projects match “${escapeHtml(o.query.trim())}”</div>` +
      `<button class="ls-btn" type="button">Clear search</button>`;
    box.querySelector("button")!.addEventListener("click", o.onClearQuery);
    return box;
  }
  box.innerHTML = `<div class="ls-empty-icon">${icon(o.place === "trash" ? "trash" : "file-text")}</div><div class="ls-empty-text">${EMPTY_TEXT[o.place]}</div>`;
  if (o.place === "projects") {
    const button = el("button", { class: "ls-btn ls-btn-primary", type: "button", html: `${icon("plus")}<span>New project</span>` });
    button.addEventListener("click", () => o.onNew(button));
    box.append(button);
  }
  return box;
}
