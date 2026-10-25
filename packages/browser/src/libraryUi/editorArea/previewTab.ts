// Shows a project's live PDF preview, or the helper setup card while the helper cannot open the project yet.
import type { BuildOptions, LatexEngine } from "@labshelf/core";
import { renderElement } from "@labshelf/core/dom";
import { mountHelperSetupCard } from "../../helper/setup";
import { bx, getSettings, updateSettings } from "../../platform";
import { createBrowserProjectData } from "../../writing/project";
import { createPreviewFrame, followBuilds, previewRequestHandler, type PreviewLimits } from "../../writing/preview";
import type { TabModule } from "./tabKind";

/** Engine and halt-on-error are LaTeX choices, so a Typst project's menu leaves them out. */
function buildOptionsOf(project: { format?: string; engine?: LatexEngine | undefined } | undefined, user: Pick<BuildOptions, "autoCompile" | "haltOnError">): BuildOptions {
  if (project?.format !== "latex") return { autoCompile: user.autoCompile };
  return { ...user, engine: project.engine ?? null };
}

export const mountTab: TabModule["mountTab"] = (host, params, { project, logger, fs, workspace }) => {
  const { helperProject, session } = project();
  const projectId = params["projectId"] ?? "";
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill" }));
  let current: { dispose(): void } | undefined;
  let showingFrame = false;
  let disposed = false;

  const showFrame = async (): Promise<void> => {
    showingFrame = true;
    // The build options menu needs the user's settings before the first roots are posted.
    const { autoCompile, haltOnError } = await getSettings();
    if (disposed) return;
    current?.dispose();
    body.replaceChildren();
    const entry = session.current();
    const ready = entry?.kind === "ready" && entry.settings.id === projectId ? entry : undefined;
    const frame = createPreviewFrame(body, { id: projectId, title: ready?.settings.title ?? projectId });
    const limits: PreviewLimits = { ...ready?.settings.check };
    const options = buildOptionsOf(ready?.settings, { autoCompile, haltOnError });
    const follow = followBuilds(helperProject, frame, { id: projectId, main: ready?.main, limits: () => limits, options: () => options }, logger);
    const offRequest = frame.onRequest(previewRequestHandler({
      project: { id: projectId, folder: ready?.folder }, fs, logger, workspace, helperProject,
      data: createBrowserProjectData({ fs, logger }), builds: follow, limits, options, updateSettings,
    }));
    current = { dispose() { offRequest(); follow.dispose(); frame.dispose(); } };
  };
  const openFrame = (): void => {
    showFrame().catch((error: unknown) => logger.error("preview", error, { action: "showFrame", projectId }));
  };
  const showSetup = (): void => {
    const card = renderElement("div", { class: "ls-preview-setup" });
    body.replaceChildren(card);
    current = mountHelperSetupCard(card, helperProject.setupHelper, {
      logger,
      getPlatformInfo: () => bx.runtime.getPlatformInfo(),
      openUrl: (url) => void bx.tabs.create({ url }),
    });
  };

  const offOpened = helperProject.onOpened((openedId) => { if (openedId === projectId && !showingFrame) openFrame(); });
  if (helperProject.isOpen(projectId)) openFrame(); else showSetup();

  return {
    dispose() {
      disposed = true;
      offOpened();
      current?.dispose();
      body.remove();
    },
  };
};
