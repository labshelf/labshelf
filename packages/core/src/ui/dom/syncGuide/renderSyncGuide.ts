/** Renders the sync guide as a page: intro, one section per tool, the no-cloud option and the steps after setup. */
import type { SyncGuide } from "../../../library/syncGuide/index.js";
import { el } from "../dom.js";
import { toolSection } from "./toolSection.js";

export interface SyncGuideHost {
  /** Opens a tool's official page; webviews cannot navigate, so the host does it. */
  onOpenLink: (url: string) => void;
}

export function renderSyncGuide(guide: SyncGuide, host: SyncGuideHost): HTMLElement {
  const { onOpenLink } = host;
  const sections = guide.tools.map((tool) => toolSection({ tool, icon: "cloud", onOpenLink }));
  const noCloud = toolSection({
    tool: guide.noCloud.tool,
    icon: "cloud-off",
    className: "sync-guide-no-cloud",
    headingPrefix: guide.noCloud.title,
    onOpenLink,
  });
  const afterSteps = el("ol", { class: "sync-guide-steps" });
  for (const step of guide.afterSetup.steps) afterSteps.append(el("li", { text: step }));
  const after = el(
    "section",
    { class: "sync-guide-section" },
    el("h2", { text: guide.afterSetup.title }),
    afterSteps,
    el("p", { class: "sync-guide-pitch", text: guide.afterSetup.conflictNote }),
  );
  return el(
    "main",
    { class: "sync-guide" },
    el("h1", { text: guide.title }),
    el("p", { class: "sync-guide-intro", text: guide.intro }),
    ...sections,
    noCloud,
    after,
  );
}
