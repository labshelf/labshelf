/** Renders the sync guide as a page: intro, one section per tool, the no-cloud option and the steps after setup. */
import type { SyncGuide, SyncGuideTool } from "../../../library/syncGuide/index.js";
import { el } from "../dom.js";
import { icon, type IconName } from "../../icons/index.js";

interface ToolSectionOptions {
  tool: SyncGuideTool;
  /** The icon beside the heading. */
  icon: IconName;
  /** Extra class, e.g. to set the section apart. */
  className?: string;
  /** Text before the tool name in the heading, e.g. "No cloud?". */
  headingPrefix?: string;
  onOpenLink: (url: string) => void;
}

// PLATFORM: a webview cannot navigate, so the host opens the link; the href keeps it focusable and copyable.
function link(tool: SyncGuideTool, onOpenLink: (url: string) => void): HTMLAnchorElement {
  const anchor = el(
    "a",
    { class: "sync-guide-link", href: tool.url, rel: "noopener noreferrer" },
    el("span", { class: "sync-guide-icon", html: icon("external") }),
    `Open ${tool.name} site`,
  );
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    onOpenLink(tool.url);
  });
  return anchor;
}

function toolSection(options: ToolSectionOptions): HTMLElement {
  const { tool } = options;
  const heading = el(
    "h2",
    {},
    el("span", { class: "sync-guide-icon", html: icon(options.icon) }),
    options.headingPrefix ? `${options.headingPrefix} ${tool.name}` : tool.name,
  );
  const platforms = el("ul", { class: "sync-guide-platforms", "aria-label": "Platforms" });
  for (const platform of tool.platforms) platforms.append(el("li", { text: platform }));
  const steps = el("ol", { class: "sync-guide-steps" });
  for (const step of tool.steps) steps.append(el("li", { text: step }));
  return el(
    "section",
    { class: ["sync-guide-section", options.className].filter(Boolean).join(" ") },
    heading,
    el("p", { class: "sync-guide-pitch", text: tool.pitch }),
    platforms,
    steps,
    link(tool, options.onOpenLink),
  );
}

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
