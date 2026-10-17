// Renders the shared "How to sync between computers" guide as plain text for the terminal.
import type { SyncGuide, SyncGuideTool } from "@labshelf/core";

function toolText(tool: SyncGuideTool): string[] {
  return [
    `${tool.name} (${tool.platforms.join(", ")})`,
    `  ${tool.pitch}`,
    ...tool.steps.map((step, index) => `  ${index + 1}. ${step}`),
    `  ${tool.url}`,
  ];
}

/** @returns the guide as paragraphs separated by blank lines */
export function syncGuideText(guide: SyncGuide): string {
  const sections = [
    [guide.title, "=".repeat(guide.title.length), "", guide.intro],
    ...guide.tools.map(toolText),
    [guide.noCloud.title, ...toolText(guide.noCloud.tool)],
    [guide.afterSetup.title, ...guide.afterSetup.steps.map((step, index) => `  ${index + 1}. ${step}`), "", guide.afterSetup.conflictNote],
  ];
  return sections.map((lines) => lines.join("\n")).join("\n\n");
}
