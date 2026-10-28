// Shows the project's history page, answered in the same page over a loopback channel.
import { createLoopbackTransport, type HistoryToHost, type HostToHistory } from "@labshelf/core";
import { mountProjectHistory } from "@labshelf/core/dom";
import { mountHistoryHost } from "../../writing";
import { mountProjectPage } from "./projectPageTab";
import type { TabModule } from "./tabKinds";

const MODULE = "tabs.history";

export const mountTab: TabModule["mountTab"] = (host, params, ctx) => {
  const { fs, logger, project } = ctx;
  const { helperProject, sharing } = project();
  const projectId = params["projectId"] ?? "";
  return mountProjectPage(host, projectId, ctx, {
    name: "history", module: MODULE, action: "openHistory",
    mount: (body, entry) => {
      const { ui, host: endpoint } = createLoopbackTransport<HistoryToHost, HostToHistory>();
      const hostEnd = mountHistoryHost({ fs, logger, endpoint, project: { id: projectId, folder: entry.folder }, lastFullPdf: helperProject.lastFullPdf, shares: sharing.shares });
      mountProjectHistory(body, ui);
      return hostEnd;
    },
  });
};
