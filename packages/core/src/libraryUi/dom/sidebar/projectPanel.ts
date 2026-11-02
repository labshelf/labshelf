// Draws the open project's panel: the project's name, then titled sections of choices, opened from its sidebar row.
import { showSectionPanel, type SectionPanel, type SectionPanelItem, type SectionPanelSection } from "../../../ui/dom/index.js";

export type ProjectPanelItem = Pick<SectionPanelItem, "label" | "icon" | "run">;
export type ProjectPanelSection = SectionPanelSection;
export type ProjectPanel = Pick<SectionPanel, "detail" | "sections" | "danger"> & { name: string };

/** Opens the panel below the project's row; empty sections are left out. */
export function showProjectPanel(anchor: HTMLElement, panel: ProjectPanel): void {
  // The panel matches the row it opens from, so it reads as that project's options rather than a context menu.
  showSectionPanel(anchor, { ...panel, label: `${panel.name} options`, width: Math.max(220, anchor.getBoundingClientRect().width) });
}
