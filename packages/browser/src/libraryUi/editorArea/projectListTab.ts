// Shows the All projects page as a workspace tab, served by the browser's project library over the library folder.
import { createLoopbackTransport, serveAllProjects, type AllProjectsToHost, type HostToAllProjects } from "@labshelf/core";
import { renderElement, mountAllProjects } from "@labshelf/core/dom";
import { createPageProjectLibrary } from "../../writing";
import type { TabModule } from "./tabKinds";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const library = createPageProjectLibrary({ fs: ctx.fs, logger: ctx.logger, workspace: ctx.workspace, session: ctx.project().session });
  const { ui, host: endpoint } = createLoopbackTransport<AllProjectsToHost, HostToAllProjects>();
  const stop = serveAllProjects(endpoint, library, ctx.logger);
  // Closing the tab leaves Details showing the last project.
  const stopSelection = endpoint.subscribe((m) => {
    if (m.type === "project.selected") ctx.selection.publish("projects", m.id ? { kind: "project", id: m.id } : null);
  });
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }));
  mountAllProjects(body, { transport: ui, prefs: ctx.prefs, sharing: ctx.sharing });
  return { dispose: () => { stopSelection(); stop(); body.remove(); } };
};
