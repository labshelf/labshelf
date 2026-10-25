// Decides which tabs a page load opens: the tabs hash, else the tabs kept for the session around a folder deep link, else the default tab.
import { isKindShown, type PagePlan } from "../pagePlan";
import { isFolderHash, parseWorkspaceHash, type WorkspaceHashState } from "./workspaceHash";

export interface RestorePlan extends WorkspaceHashState {
  /** True when the Library tab shows the folder the URL names, so the router's folder is left in place. */
  folderLink: boolean;
}

const LIBRARY = "library";

const shown = (plan: PagePlan, tabs: readonly string[]): string[] => tabs.filter((id) => isKindShown(plan, id.split(":")[0]!));

/** `stored` is the last tabs hash this browser tab wrote; it lets a folder deep link reload without losing the open tabs. Tabs of a hidden section are dropped. */
export function planRestore(hash: string, stored: string | null, plan: PagePlan): RestorePlan {
  const fromHash = parseWorkspaceHash(hash);
  const listed = fromHash ? shown(plan, fromHash.tabs) : [];
  if (fromHash && listed.length > 0) return { tabs: listed, active: fromHash.active !== null && listed.includes(fromHash.active) ? fromHash.active : listed[0]!, folderLink: false };
  if (plan.library && isFolderHash(hash)) {
    const kept = shown(plan, (stored !== null ? parseWorkspaceHash(stored)?.tabs : undefined) ?? []);
    return { tabs: kept.includes(LIBRARY) ? kept : [LIBRARY, ...kept], active: LIBRARY, folderLink: true };
  }
  return { tabs: [plan.defaultTab], active: plan.defaultTab, folderLink: false };
}
