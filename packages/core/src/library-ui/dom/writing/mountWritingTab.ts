// Mounts the Writing tab: lists the host's writing projects and routes PDF, paper and reading-list clicks back to it.
import { brokenProjectHtml, emptyHtml, failedHtml, loadingHtml, readyProjectHtml } from "./writingTabMarkup.js";
import type { WritingTabHost, WritingTabProject } from "./writingTabHost.js";

export interface WritingTab {
  /** Lists the projects again; a failure is shown in the tab and does not reject. */
  refresh(): Promise<void>;
  dispose(): void;
}

function projectsHtml(projects: WritingTabProject[], expanded: ReadonlySet<string>): string {
  if (!projects.length) { return emptyHtml(); }
  const rows = projects.map((p, i) => p.kind === "ready" ? readyProjectHtml(p, i, expanded.has(p.id)) : brokenProjectHtml(p));
  return `<ul class="wt-projects" aria-label="Writing projects">${rows.join("")}</ul>`;
}

function toggleReadingList(button: HTMLElement, expanded: Set<string>): void {
  const row = button.closest<HTMLElement>(".wt-project");
  const id = row?.dataset.projectId;
  const list = row?.querySelector<HTMLElement>(".wt-reading");
  if (id === undefined || !list) { return; }
  const open = button.getAttribute("aria-expanded") !== "true";
  if (open) { expanded.add(id); } else { expanded.delete(id); }
  button.setAttribute("aria-expanded", String(open));
  button.title = `${open ? "Hide" : "Show"} the reading list`;
  list.hidden = !open;
}

export function mountWritingTab(root: HTMLElement, host: WritingTabHost): WritingTab {
  root.classList.add("ls-writing-tab");
  const expanded = new Set<string>();
  // INVARIANT: only the latest refresh paints, so a slow earlier listing cannot overwrite a newer one.
  let generation = 0;

  async function refresh(): Promise<void> {
    const mine = ++generation;
    if (!root.querySelector(".wt-projects")) { root.innerHTML = loadingHtml(); }
    try {
      const projects = await host.listProjects();
      if (mine === generation) { root.innerHTML = projectsHtml(projects, expanded); }
    } catch (error) {
      if (mine === generation) { root.innerHTML = failedHtml(error instanceof Error ? error.message : String(error)); }
    }
  }

  function onClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled || !root.contains(button)) { return; }
    const { action, project, pdf, paper } = button.dataset;
    if (action === "toggle") { toggleReadingList(button, expanded); }
    else if (action === "openPdf" && project !== undefined && pdf !== undefined) { host.openPdf(project, pdf); }
    else if (action === "openPaper" && paper !== undefined) { host.openPaper(paper); }
    else if (action === "edit" && project !== undefined) { host.editProject(project); }
    else if (action === "retry") { void refresh(); }
  }

  root.addEventListener("click", onClick);
  void refresh();
  return {
    refresh,
    dispose() {
      generation++;
      root.removeEventListener("click", onClick);
      root.classList.remove("ls-writing-tab");
      root.replaceChildren();
    },
  };
}
