// Mounts the All projects detail pane: head, tabs and folds for the selected project, with the pane's actions.
import { loading, muted, tabBarHtml } from "../../../../libraryUi/dom/index.js";
import type { ProjectDetail } from "../../projectDetailPane.js";
import type { ProjectRow } from "../../projectRow.js";
import { runProjectDetailAction, type ProjectDetailActionDeps } from "./projectDetailPaneActions.js";
import { citationsTabHtml, overviewTabHtml, projectDetailTabs, versionsTabHtml } from "./tabs/index.js";
import { projectDetailHeadHtml } from "./projectDetailPaneHead.js";

export interface ProjectDetailView {
  row: ProjectRow | undefined;
  detail: ProjectDetail | undefined;
  error: string | undefined;
  /** The host's label for the primary button, such as "Open in VS Code". */
  openLabel: string;
}

interface ProjectDetailPane {
  update(view: ProjectDetailView): void;
}

interface PaneState {
  view: ProjectDetailView;
  tab: string;
  /** Only the folds the user toggled; sections not listed keep their default. */
  collapsed: Record<string, boolean>;
}

function bodyHtml(s: PaneState, row: ProjectRow, now: number): string {
  const { detail, error } = s.view;
  if (error) return muted(error);
  if (!detail) return loading();
  if (s.tab === "citations") return citationsTabHtml(detail);
  if (s.tab === "versions") return versionsTabHtml(detail.versions, now);
  return overviewTabHtml(row, detail, s.collapsed, now);
}

function paneHtml(s: PaneState): string {
  const { row, detail, openLabel } = s.view;
  if (!row) return muted("Select a project to see its details.");
  const now = Date.now();
  return projectDetailHeadHtml(row, detail, { openLabel, now }) + tabBarHtml(projectDetailTabs(detail), s.tab) +
    `<div class="tab-body">${bodyHtml(s, row, now)}</div>`;
}

function toggleSection(slot: HTMLElement, s: PaneState, head: HTMLElement): void {
  const sec = head.dataset["sec"]!;
  const closed = head.getAttribute("aria-expanded") === "true";
  s.collapsed = { ...s.collapsed, [sec]: closed };
  head.classList.toggle("collapsed", closed);
  head.setAttribute("aria-expanded", String(!closed));
  slot.querySelector(`[data-sec-body="${sec}"]`)?.classList.toggle("hidden", closed);
}

export function mountProjectDetail(slot: HTMLElement, deps: ProjectDetailActionDeps): ProjectDetailPane {
  const s: PaneState = { view: { row: undefined, detail: undefined, error: undefined, openLabel: "Open" }, tab: "overview", collapsed: {} };
  const render = (): void => { slot.innerHTML = paneHtml(s); };

  slot.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>("[data-action]");
    const row = s.view.row;
    if (button && row && !(button as HTMLButtonElement).disabled) {
      const action = button.dataset["action"]!;
      if (action !== "tab") { runProjectDetailAction(action, button, row, deps); return; }
      s.tab = button.dataset["tab"]!;
      render();
      // Deep in a long tab, switching lands at the top of the new one, under the sticky tab bar.
      const bar = slot.querySelector<HTMLElement>(".detail-tabs");
      if (bar) slot.scrollTop = Math.min(slot.scrollTop, bar.offsetTop);
      return;
    }
    const head = target.closest<HTMLElement>(".sec-head");
    if (head) toggleSection(slot, s, head);
  });
  slot.addEventListener("keydown", (e) => {
    const head = (e.target as HTMLElement).closest<HTMLElement>(".sec-head");
    if (!head || (e.key !== "Enter" && e.key !== " ")) return;
    toggleSection(slot, s, head);
    e.preventDefault();
  });

  render();
  return { update(view) { s.view = view; render(); } };
}
