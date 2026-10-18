// Shows the All projects page as a workspace tab, served by the browser's project library over the library folder.
import { createLoopbackTransport, serveAllProjects, type AllProjectsToHost, type HostToAllProjects } from "@labshelf/core";
import { el, mountAllProjects } from "@labshelf/core/dom";
import { listAllRecords } from "../../../storage";
import { askBlankProject, browserPdfjs, createBrowserProjectLibrary } from "../../projects-data";
import type { TabModule } from "../types";

export const mountTab: TabModule["mountTab"] = (host, _params, ctx) => {
  const library = createBrowserProjectLibrary({
    fs: ctx.fs, logger: ctx.logger, workspace: ctx.workspace, session: ctx.session, pdfjs: browserPdfjs, listPapers: listAllRecords, askBlank: askBlankProject,
  });
  const { ui, host: endpoint } = createLoopbackTransport<AllProjectsToHost, HostToAllProjects>();
  const stop = serveAllProjects(endpoint, library, ctx.logger);
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  mountAllProjects(body, { transport: ui, prefs: ctx.prefs });
  return { dispose: () => { stop(); body.remove(); } };
};
