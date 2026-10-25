// Shows the project's search page, answered in the same page over a loopback channel.
import { createLoopbackTransport, type HostToSearch, type SearchToHost } from "@labshelf/core";
import { el, mountProjectSearch } from "@labshelf/core/dom";
import { revealInOpenEditor } from "../../writing/session";
import { mountSearchHost } from "../../writing/mountSearchHost";
import { findProject } from "../../writing/project";
import type { TabModule } from "./tabKind";

const MODULE = "tabs.search";

export const mountTab: TabModule["mountTab"] = (host, params, { fs, logger, project, workspace }) => {
  const { session } = project();
  const projectId = params["projectId"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  const loading = body.appendChild(el("p", { class: "ls-workspace-placeholder" }, "Loading search…"));
  let disposed = false;
  let hostEnd: { dispose(): void } | undefined;
  findProject(fs, logger, session.current(), projectId)
    .then((entry) => {
      if (disposed) return;
      const { ui, host: endpoint } = createLoopbackTransport<SearchToHost, HostToSearch>();
      const openMatch = (path: string, line: number): void => {
        workspace.openTab("source", { projectId, path }, 0);
        revealInOpenEditor(projectId, path, line);
      };
      hostEnd = mountSearchHost({ fs, logger, endpoint, project: { id: projectId, folder: entry.folder }, openMatch });
      loading.remove();
      mountProjectSearch(body, ui);
    })
    .catch((error: unknown) => {
      loading.textContent = "Could not open the search.";
      void logger.error(MODULE, error, { action: "openSearch", projectId });
    });
  return { dispose: () => { disposed = true; hostEnd?.dispose(); body.remove(); } };
};
