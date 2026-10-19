// Shows a project's live PDF preview, or the helper setup card while the helper cannot open the project yet.
import { el } from "@labshelf/core/dom";
import { mountHelperSetupCard } from "../../../helper/setup";
import { bx } from "../../../platform";
import { createBrowserProjectData } from "../../projects-data";
import { createPreviewFrame, followBuilds, type PreviewLimits } from "../../preview";
import type { TabModule } from "../types";
import { previewRequestHandler } from "./previewRequests";

export const mountTab: TabModule["mountTab"] = (host, params, { project, logger, fs, workspace }) => {
  const { helperProject, session } = project();
  const projectId = params["projectId"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  let current: { dispose(): void } | undefined;
  let showingFrame = false;

  const showFrame = (): void => {
    current?.dispose();
    body.replaceChildren();
    const entry = session.current();
    const ready = entry?.kind === "ready" && entry.settings.id === projectId ? entry : undefined;
    const frame = createPreviewFrame(body, { id: projectId, title: ready?.settings.title ?? projectId });
    const limits: PreviewLimits = { ...ready?.settings.check };
    const follow = followBuilds(helperProject, frame, { id: projectId, main: ready?.main, limits: () => limits }, logger);
    const offRequest = frame.onRequest(previewRequestHandler({
      project: { id: projectId, folder: ready?.folder }, fs, logger, workspace, helperProject,
      data: createBrowserProjectData({ fs, logger }), builds: follow, limits,
    }));
    current = { dispose() { offRequest(); follow.dispose(); frame.dispose(); } };
    showingFrame = true;
  };
  const showSetup = (): void => {
    const card = el("div", { class: "ls-preview-setup" });
    body.replaceChildren(card);
    current = mountHelperSetupCard(card, helperProject.setupHelper, {
      logger,
      getPlatformInfo: () => bx.runtime.getPlatformInfo(),
      openUrl: (url) => void bx.tabs.create({ url }),
    });
  };

  const offOpened = helperProject.onOpened((openedId) => { if (openedId === projectId && !showingFrame) showFrame(); });
  if (helperProject.isOpen(projectId)) showFrame(); else showSetup();

  return {
    dispose() {
      offOpened();
      current?.dispose();
      body.remove();
    },
  };
};
