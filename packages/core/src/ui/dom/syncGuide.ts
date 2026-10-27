/** Renders the sync guide as a page: intro, one section per tool, the no-cloud option and the steps after setup. */
import type { SyncGuide, SyncGuideTool } from "../../library/index.js";
import { renderElement } from "./dom.js";
import { renderIcon, type IconName } from "../icons/index.js";

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
  const anchor = renderElement(
    "a",
    { class: "sync-guide-link", href: tool.url, rel: "noopener noreferrer" },
    renderElement("span", { class: "sync-guide-icon", html: renderIcon("external") }),
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
  const heading = renderElement(
    "h2",
    {},
    renderElement("span", { class: "sync-guide-icon", html: renderIcon(options.icon) }),
    options.headingPrefix ? `${options.headingPrefix} ${tool.name}` : tool.name,
  );
  const platforms = renderElement("ul", { class: "sync-guide-platforms", "aria-label": "Platforms" });
  for (const platform of tool.platforms) platforms.append(renderElement("li", { text: platform }));
  const steps = renderElement("ol", { class: "sync-guide-steps" });
  for (const step of tool.steps) steps.append(renderElement("li", { text: step }));
  return renderElement(
    "section",
    { class: ["sync-guide-section", options.className].filter(Boolean).join(" ") },
    heading,
    renderElement("p", { class: "sync-guide-pitch", text: tool.pitch }),
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
  const afterSteps = renderElement("ol", { class: "sync-guide-steps" });
  for (const step of guide.afterSetup.steps) afterSteps.append(renderElement("li", { text: step }));
  const after = renderElement(
    "section",
    { class: "sync-guide-section" },
    renderElement("h2", { text: guide.afterSetup.title }),
    afterSteps,
    renderElement("p", { class: "sync-guide-pitch", text: guide.afterSetup.conflictNote }),
  );
  return renderElement(
    "main",
    { class: "sync-guide" },
    renderElement("h1", { text: guide.title }),
    renderElement("p", { class: "sync-guide-intro", text: guide.intro }),
    ...sections,
    noCloud,
    after,
  );
}
