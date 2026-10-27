// Mounts a tab that finds its project and then shows one project page, with a loading line until the project is found.
import type { ProjectEntry } from "@labshelf/core";
import { renderElement, type EditorTabBody } from "@labshelf/core/dom";
import { findProject } from "../../writing/project";
import type { TabContext } from "./tabKinds";

export interface ProjectPage {
  /** The page in the loading and failure lines, like "history". */
  name: string;
  module: string;
  /** The action the failure is logged under. */
  action: string;
  /** Mounts the page into `body` and returns what stops its host. */
  mount(body: HTMLElement, entry: Extract<ProjectEntry, { kind: "ready" }>): { dispose(): void };
}

export function mountProjectPage(host: HTMLElement, projectId: string, { fs, logger, project }: TabContext, page: ProjectPage): EditorTabBody {
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }));
  const loading = body.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${page.name}…`));
  let disposed = false;
  let hostEnd: { dispose(): void } | undefined;
  findProject(fs, logger, project().session.current(), projectId)
    .then((entry) => {
      if (disposed) return;
      hostEnd = page.mount(body, entry);
      loading.remove();
    })
    .catch((error: unknown) => {
      loading.textContent = `Could not open the ${page.name}.`;
      void logger.error(page.module, error, { action: page.action, projectId });
    });
  return { dispose: () => { disposed = true; hostEnd?.dispose(); body.remove(); } };
}
