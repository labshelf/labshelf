// Decides what the library page mounts from the sidebar sections setting: the sections, the tab kinds it may open and the default tab.
import type { SidebarSections } from "../../platform";
import type { TabKindName } from "../tabs";

export interface PagePlan extends SidebarSections {
  /** The tab a page load opens when nothing says otherwise. */
  defaultTab: TabKindName;
}

export function planPage(sections: SidebarSections): PagePlan {
  return { ...sections, defaultTab: sections.library ? "library" : "all-projects" };
}

/** True when the tab kind belongs to a shown section; the Library tab is the Library section, every other kind is a project tab. */
export function isKindShown(plan: PagePlan, kind: string): boolean {
  return kind === "library" ? plan.library : plan.projects;
}
