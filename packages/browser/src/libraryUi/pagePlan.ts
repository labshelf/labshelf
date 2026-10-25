// Decides what the library page mounts from the sidebar sections setting: the sections, the tab kinds it may open and the default tab.
import type { SidebarSections } from "../platform";
import type { TabKindName } from "./editorArea";

export interface PagePlan extends SidebarSections {
  /** The tab a page load opens when nothing says otherwise. */
  defaultTab: TabKindName;
}

export function derivePagePlan(sections: SidebarSections): PagePlan {
  return { ...sections, defaultTab: sections.library ? "library" : "all-projects" };
}

/** Keeps Library and Spaces tabs under the Library section setting. */
export function isKindShown(plan: PagePlan, kind: string): boolean {
  return ["library", "spaces", "space"].includes(kind) ? plan.library : plan.projects;
}
