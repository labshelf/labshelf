// Shows the All projects page as a workspace tab, served by the browser's project library over the library folder.
import { createLoopbackTransport, serveAllProjects, type AllProjectsToHost, type HostToAllProjects } from "@labshelf/core";
import { el, mountAllProjects } from "@labshelf/core/dom";
import { createPageProjectLibrary } from "../../projects-data";
import type { TabModule } from "../types";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const library = createPageProjectLibrary({ fs: ctx.fs, logger: ctx.logger, workspace: ctx.workspace, session: ctx.project().session });
  const { ui, host: endpoint } = createLoopbackTransport<AllProjectsToHost, HostToAllProjects>();
  const stop = serveAllProjects(endpoint, library, ctx.logger);
  // Closing the tab leaves Details showing the last project.
  const stopSelection = endpoint.subscribe((m) => {
    if (m.type === "project.selected") ctx.selection.publish("projects", m.id ? { kind: "project", id: m.id } : null);
  });
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  mountAllProjects(body, { transport: ui, prefs: ctx.prefs });
  return { dispose: () => { stopSelection(); stop(); body.remove(); } };
};
