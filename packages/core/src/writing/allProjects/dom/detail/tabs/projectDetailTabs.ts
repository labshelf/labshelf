// Lists the tabs of the All projects detail pane, with the citation and version counts as badges.
import type { TabSpec } from "../../../../../library-ui/dom/index.js";
import type { ProjectDetail } from "../../../projectDetail.js";

const tab = (id: string, label: string, n: number | undefined): TabSpec => (n ? { id, label, badge: String(n) } : { id, label });

export function projectDetailTabs(detail: ProjectDetail | undefined): TabSpec[] {
  return [tab("overview", "Overview", undefined), tab("citations", "Citations", detail?.citations.length), tab("versions", "Versions", detail?.versions.length)];
}
