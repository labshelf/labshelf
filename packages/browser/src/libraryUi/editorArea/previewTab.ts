// Shows a project's live PDF preview, or the helper setup card while the helper cannot open the project yet.
import { describeSourceDeck, lastDeckPageMap, readTalkPages, type BuildOptions, type ILogger, type LatexEngine, type PreviewDeck } from "@labshelf/core";
import { renderElement } from "@labshelf/core/dom";
import type { HelperProject } from "@labshelf/core/helper";
import { mountHelperSetupCard } from "../../helper";
import { bx, readSettings, updateSettings } from "../../platform";
import { createBrowserProjectContent, createPreviewFrame, watchBuilds, createPreviewRequestHandler } from "../../writing";
import type { PreviewLimits } from "@labshelf/core";
import type { TabModule } from "./tabKinds";
import { openDeckAudienceTab } from "./workspace";

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

/** The deck the build is of, with a talk's slides: its pages carry its notes only by the page map of a build of it in this page. */
async function deckOfBuild(fs: { readText(path: string): Promise<string> }, projectId: string, build: { folder: string; format?: string | undefined; main: string } | undefined): Promise<PreviewDeck | undefined> {
  if (!build) return undefined;
  const { main } = build;
  const text = await fs.readText(`${build.folder}/${main}`);
  const found = describeSourceDeck(build.format === "typst" ? "typst" : "latex", main, text);
  const pages = found?.kind === "talk" ? readTalkPages(lastDeckPageMap(projectId, main), main, text) : undefined;
  return found && (pages ? { ...found, slideOfPage: pages.slideOfPage } : found);
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
    const main = ready?.main;
    const deck = (): Promise<PreviewDeck | undefined> => deckOfBuild(fs, projectId, ready && main ? { folder: ready.folder, format: ready.settings.format, main } : undefined);
    const follow = watchBuilds(helperProject, frame, { id: projectId, main, limits: () => limits, options: () => options, deck }, logger);
    const offRequest = frame.onRequest(createPreviewRequestHandler({
      project: { id: projectId, folder: ready?.folder }, fs, logger, workspace, helperProject, openAudience: openDeckAudienceTab,
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
