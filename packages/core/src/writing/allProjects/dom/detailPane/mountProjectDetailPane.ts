// Mounts the All projects detail pane: head, tabs and folds for the selected project, with the pane's actions.
import { renderLoading, renderMuted, renderTabBarHtml, renderIconButton } from "../../../../libraryUi/dom/index.js";
import type { ProjectPaneContent } from "../../projectDetailPane.js";
import type { ProjectRow } from "../../projectRow.js";
import { renderCitationsTabHtml, renderOverviewTabHtml, deriveProjectPaneTabs, renderVersionsTabHtml } from "./tabs/index.js";
import { askInputBox, showMenu } from "../../../../ui/dom/index.js";
import type { Post } from "../projectActions.js";
import { createProjectMenuEntries, type ProjectMenuContext } from "../projectMenu.js";
import { escapeHtml, renderIcon } from "../../../../ui/index.js";
import { formatDeadlineText } from "../../formatDeadlineText.js";
import { formatProjectBuildStateText, formatMetaLine } from "./projectDetailPaneText.js";

export interface ProjectHeadOptions {
  /** The host's label for the primary button, such as "Open in VS Code". */
  openLabel: string;
  now: number;
}

function targetMark(row: ProjectRow, now: number): string {
  const left = formatDeadlineText(row.target, now);
  const text = [row.target?.venue, left?.text].filter(Boolean).join(" · ");
  if (!text) return "";
  const tone = left && left.tone !== "normal" ? ` tone-${left.tone}` : "";
  return `<span class="status-target${tone}">${renderIcon("target")}<span>${escapeHtml(text)}</span></span>`;
}

/** The status comes from the row until the detail, which knows the warning count, arrives. */
export function renderProjectPaneHeadHtml(row: ProjectRow, detail: ProjectPaneContent | undefined, o: ProjectHeadOptions): string {
  const build = detail?.build ?? row.build;
  return `<div class="detail-head">` +
    `<div class="head-more">${renderIconButton("more", "more", "More actions")}</div>` +
    `<div class="detail-title">${escapeHtml(row.title)}</div>` +
    `<div class="detail-meta">${escapeHtml(formatMetaLine(row, detail?.pages, o.now))}</div>` +
    `<div class="detail-toolbar">` +
      `<button class="ls-btn ls-button-soft open-btn" type="button" data-action="open">${escapeHtml(o.openLabel)}</button>` +
      `<button class="ls-btn ls-btn-ghost" type="button" data-action="preview">Preview</button>` +
    `</div>` +
    `<div class="detail-status-row">` +
      `<span class="status-build"><span class="ls-build-dot b-${build?.state ?? "never"}"></span>${escapeHtml(formatProjectBuildStateText(build))}</span>` +
      targetMark(row, o.now) +
    `</div></div>`;
}

interface ProjectDetailActionDeps {
  post: Post;
  /** Read at click time so the menu sees the latest rows and host commands. */
  menu: () => ProjectMenuContext;
}

function validateDeadline(value: string): string | null {
  if (value === "") return null;
  // The round trip rejects impossible dates such as 2027-02-31, which Date.parse would roll over.
  const at = Date.parse(`${value}T00:00:00Z`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
  return valid ? null : "Write the deadline as YYYY-MM-DD";
}

async function editTarget(row: ProjectRow, post: Post): Promise<void> {
  const venue = await askInputBox({ title: "Target venue", prompt: "Where is this project headed? Leave empty to clear it.", value: row.target?.venue ?? "" });
  if (venue === undefined) return;
  const deadline = await askInputBox({ title: "Deadline", prompt: "YYYY-MM-DD. Leave empty for no deadline.", value: row.target?.deadline ?? "", validate: validateDeadline });
  if (deadline === undefined) return;
  post({ type: "setTarget", id: row.id, ...(venue ? { venue } : {}), ...(deadline ? { deadline } : {}) });
}

function runProjectDetailAction(action: string, anchor: HTMLElement, row: ProjectRow, deps: ProjectDetailActionDeps): void {
  if (action === "open" || action === "preview" || action === "build" || action === "openLog") deps.post({ type: action, id: row.id });
  else if (action === "more") showMenu(anchor, createProjectMenuEntries(row, deps.menu()));
  else if (action === "editTarget") void editTarget(row, deps.post);
}

export interface ProjectPaneView {
  row: ProjectRow | undefined;
  detail: ProjectPaneContent | undefined;
  error: string | undefined;
  /** The host's label for the primary button, such as "Open in VS Code". */
  openLabel: string;
}

interface ProjectDetailPane {
  update(view: ProjectPaneView): void;
}

interface PaneState {
  view: ProjectPaneView;
  tab: string;
  /** Only the folds the user toggled; sections not listed keep their default. */
  collapsed: Record<string, boolean>;
}

function bodyHtml(s: PaneState, row: ProjectRow, now: number): string {
  const { detail, error } = s.view;
  if (error) return renderMuted(error);
  if (!detail) return renderLoading();
  if (s.tab === "citations") return renderCitationsTabHtml(detail);
  if (s.tab === "versions") return renderVersionsTabHtml(detail.versions, now);
  return renderOverviewTabHtml(row, detail, s.collapsed, now);
}

function paneHtml(s: PaneState): string {
  const { row, detail, openLabel } = s.view;
  if (!row) return renderMuted("Select a project to see its details.");
  const now = Date.now();
  return renderProjectPaneHeadHtml(row, detail, { openLabel, now }) + renderTabBarHtml(deriveProjectPaneTabs(detail), s.tab) +
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

export function mountProjectPane(slot: HTMLElement, deps: ProjectDetailActionDeps): ProjectDetailPane {
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
