// Shows the project's history page, answered in the same page over a loopback channel.
import { createLoopbackTransport, type HistoryToHost, type HostToHistory } from "@labshelf/core";
import { el, mountProjectHistory } from "@labshelf/core/dom";
import { findProject } from "../../projects-data";
import { mountHistoryHost } from "../../review";
import type { TabModule } from "../types";

const MODULE = "tabs.history";

export const mountTab: TabModule["mountTab"] = (host, params, { fs, logger, session, helperProject }) => {
  const projectId = params["projectId"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  const loading = body.appendChild(el("p", { class: "ls-workspace-placeholder" }, "Loading history…"));
  let disposed = false;
  let hostEnd: { dispose(): void } | undefined;
  findProject(fs, logger, session.current(), projectId)
    .then((entry) => {
      if (disposed) return;
      const { ui, host: endpoint } = createLoopbackTransport<HistoryToHost, HostToHistory>();
      hostEnd = mountHistoryHost({ fs, logger, endpoint, project: { id: projectId, folder: entry.folder }, lastFullPdf: helperProject.lastFullPdf });
      loading.remove();
      mountProjectHistory(body, ui);
    })
    .catch((error: unknown) => {
      loading.textContent = "Could not open the history.";
      void logger.error(MODULE, error, { action: "openHistory", projectId });
    });
  return { dispose: () => { disposed = true; hostEnd?.dispose(); body.remove(); } };
};
