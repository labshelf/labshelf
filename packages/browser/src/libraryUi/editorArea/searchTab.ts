// Shows the project's search page, answered in the same page over a loopback channel.
import { createLoopbackTransport, type HostToSearch, type SearchToHost } from "@labshelf/core";
import { mountProjectSearch } from "@labshelf/core/dom";
import { mountSearchHost, showInOpenEditor } from "../../writing";
import { mountProjectPage } from "./projectPageTab";
import type { TabModule } from "./tabKinds";

const MODULE = "tabs.search";

export const mountTab: TabModule["mountTab"] = (host, params, ctx) => {
  const { fs, logger, workspace } = ctx;
  const projectId = params["projectId"] ?? "";
  return mountProjectPage(host, projectId, ctx, {
    name: "search", module: MODULE, action: "openSearch",
    mount: (body, entry) => {
      const { ui, host: endpoint } = createLoopbackTransport<SearchToHost, HostToSearch>();
      const openMatch = (path: string, line: number): void => {
        workspace.openTab("source", { projectId, path }, 0);
        showInOpenEditor(projectId, path, line);
      };
      const hostEnd = mountSearchHost({ fs, logger, endpoint, project: { id: projectId, folder: entry.folder }, openMatch });
      mountProjectSearch(body, ui);
      return hostEnd;
    },
  });
};
