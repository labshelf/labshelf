// Shows the project's history page, answered in the same page over a loopback channel.
import { createLoopbackTransport, type HistoryToHost, type HostToHistory } from "@labshelf/core";
import { el, mountProjectHistory } from "@labshelf/core/dom";
import { findProject } from "../../writing/project";
import { mountHistoryHost } from "../../writing/history";
import type { TabModule } from "./tabKind";

const MODULE = "tabs.history";

export const mountTab: TabModule["mountTab"] = (host, params, { fs, logger, project }) => {
  const { session, helperProject, sharing } = project();
  const projectId = params["projectId"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  const loading = body.appendChild(el("p", { class: "ls-workspace-placeholder" }, "Loading history…"));
  let disposed = false;
  let hostEnd: { dispose(): void } | undefined;
  findProject(fs, logger, session.current(), projectId)
    .then((entry) => {
      if (disposed) return;
      const { ui, host: endpoint } = createLoopbackTransport<HistoryToHost, HostToHistory>();
      hostEnd = mountHistoryHost({ fs, logger, endpoint, project: { id: projectId, folder: entry.folder }, lastFullPdf: helperProject.lastFullPdf, shares: sharing.shares });
      loading.remove();
      mountProjectHistory(body, ui);
    })
    .catch((error: unknown) => {
      loading.textContent = "Could not open the history.";
      void logger.error(MODULE, error, { action: "openHistory", projectId });
    });
  return { dispose: () => { disposed = true; hostEnd?.dispose(); body.remove(); } };
};
