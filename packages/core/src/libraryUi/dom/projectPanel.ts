// Draws the open project's panel: the project's name, then titled sections of choices, opened from its sidebar row.
import { showSectionPanel, type SectionPanel, type SectionPanelItem, type SectionPanelSection } from "../../ui/dom/index.js";

import { formatLibraryFolder, type LibraryFolderCount } from "../../writing/citations/index.js";

export type ProjectPanelItem = Pick<SectionPanelItem, "label" | "icon" | "run" | "note" | "action">;
export type ProjectPanelSection = SectionPanelSection;
export type ProjectPanel = Pick<SectionPanel, "detail" | "sections" | "danger"> & { name: string };

/** One row per linked library folder: its path with " › " between segments, its paper count, and a button that unlinks it. */
export function createLinkedFolderItems(folders: readonly LibraryFolderCount[], unlink: (folder: string) => void): ProjectPanelItem[] {
  return folders.map(({ folder, papers }) => ({
    label: formatLibraryFolder(folder), icon: "folder-open", note: `· ${papers} ${papers === 1 ? "paper" : "papers"}`,
    action: { icon: "close", label: `Unlink ${formatLibraryFolder(folder)}`, run: () => unlink(folder) },
    run: () => undefined,
  }));
}

/** Opens the panel below the project's row; empty sections are left out. */
export function showProjectPanel(anchor: HTMLElement, panel: ProjectPanel): void {
  // The panel matches the row it opens from, so it reads as that project's options rather than a context menu.
  showSectionPanel(anchor, { ...panel, label: `${panel.name} options`, width: Math.max(220, anchor.getBoundingClientRect().width) });
}
