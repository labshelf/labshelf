// Shows a project's live PDF preview, or the helper setup card while the helper cannot open the project yet.
import type { BuildOptions, ILogger, LatexEngine } from "@labshelf/core";
import { renderElement } from "@labshelf/core/dom";
import type { HelperProject } from "@labshelf/core/helper";
import { mountHelperSetupCard } from "../../helper";
import { bx, readSettings, updateSettings } from "../../platform";
import { createBrowserProjectContent } from "../../writing";
import { createPreviewFrame, watchBuilds, createPreviewRequestHandler } from "../../writing/preview";
import type { PreviewLimits } from "@labshelf/core";
import type { TabModule } from "./tabKinds";

/** Engine and halt-on-error are LaTeX choices, so a Typst project's menu leaves them out. */
function buildOptionsOf(project: { format?: string; engine?: LatexEngine | undefined } | undefined, user: Pick<BuildOptions, "autoCompile" | "haltOnError">): BuildOptions {
  if (project?.format !== "latex") return { autoCompile: user.autoCompile };
  return { ...user, engine: project.engine ?? null };
}

/** The card that walks the user through setting up the helper in the preview's body. */
function mountSetupCard(body: HTMLElement, helperProject: HelperProject, logger: ILogger): { dispose(): void } {
  const card = renderElement("div", { class: "ls-preview-setup" });
  body.replaceChildren(card);
  return mountHelperSetupCard(card, helperProject.setupHelper, {
    logger,
    getPlatformInfo: () => bx.runtime.getPlatformInfo(),
    openUrl: (url) => void bx.tabs.create({ url }),
  });
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
    const { autoCompile, haltOnError } = await readSettings();
    if (disposed) return;
    current?.dispose();
    body.replaceChildren();
    const entry = session.current();
    const ready = entry?.kind === "ready" && entry.settings.id === projectId ? entry : undefined;
    const frame = createPreviewFrame(body, { id: projectId, title: ready?.settings.title ?? projectId });
    const limits: PreviewLimits = { ...ready?.settings.check };
    const options = buildOptionsOf(ready?.settings, { autoCompile, haltOnError });
    const follow = watchBuilds(helperProject, frame, { id: projectId, main: ready?.main, limits: () => limits, options: () => options }, logger);
    const offRequest = frame.onRequest(createPreviewRequestHandler({
      project: { id: projectId, folder: ready?.folder }, fs, logger, workspace, helperProject,
      data: createBrowserProjectContent({ fs, logger }), builds: follow, limits, options, updateSettings,
    }));
    current = { dispose() { offRequest(); follow.dispose(); frame.dispose(); } };
  };
  const openFrame = (): void => {
    showFrame().catch((error: unknown) => logger.error("preview", error, { action: "showFrame", projectId }));
  };
  const offOpened = helperProject.onOpened((openedId) => { if (openedId === projectId && !showingFrame) openFrame(); });
  if (helperProject.isOpen(projectId)) openFrame(); else current = mountSetupCard(body, helperProject, logger);

  return {
    dispose() {
      disposed = true;
      offOpened();
      current?.dispose();
      body.remove();
    },
  };
};
