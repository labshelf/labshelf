// Shows a project's live PDF preview, or the helper setup card while the helper cannot open the project yet.
import { el } from "@labshelf/core/dom";
import { mountHelperSetupCard } from "../../../helper/setup";
import { bx } from "../../../platform";
import { createPreviewFrame, followBuilds } from "../../preview";
import type { TabModule } from "../types";

export const mountTab: TabModule["mountTab"] = (host, params, { helperProject, logger }) => {
  const projectId = params["projectId"] ?? "";
  const body = host.appendChild(el("div", { class: "ls-workspace-fill" }));
  let current: { dispose(): void } | undefined;
  let showingFrame = false;

  const showFrame = (): void => {
    current?.dispose();
    body.replaceChildren();
    const frame = createPreviewFrame(body, { id: projectId, title: "Preview" });
    const follow = followBuilds(helperProject, frame, projectId, logger);
    current = { dispose() { follow.dispose(); frame.dispose(); } };
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
