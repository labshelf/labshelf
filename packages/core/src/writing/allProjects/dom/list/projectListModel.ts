// Flattens the project groups and the expanded project's tray into the treegrid's fixed-height rows, in display order.
import type { ProjectGroup } from "../../viewModel/index.js";
import type { ProjectRow } from "../../projectRow.js";
import type { ProjectTrayRow } from "../tray/index.js";

/** `key` is unique in the list; `level` is the treegrid's aria-level. */
export type ProjectListRow =
  | { kind: "group"; key: string; level: number; group: ProjectGroup; collapsed: boolean }
  | { kind: "project"; key: string; level: number; row: ProjectRow }
  | { kind: "file"; key: string; level: number; projectId: string; tray: ProjectTrayRow };

export interface ProjectListInput {
  groups: readonly ProjectGroup[];
  /** Group keys whose projects are hidden. */
  collapsed: ReadonlySet<string>;
  expanded: string | null;
  trayRows: (row: ProjectRow) => ProjectTrayRow[];
}

export const projectKey = (id: string): string => `p:${id}`;

// A group without segments holds the top-level projects, so it has no header and its projects sit at level 1.
export function projectListRows(input: ProjectListInput): ProjectListRow[] {
  const out: ProjectListRow[] = [];
  for (const group of input.groups) {
    const grouped = group.segments.length > 0;
    if (grouped) {
      const collapsed = input.collapsed.has(group.key);
      out.push({ kind: "group", key: `g:${group.key}`, level: 1, group, collapsed });
      if (collapsed) continue;
    }
    const level = grouped ? 2 : 1;
    for (const row of group.rows) {
      out.push({ kind: "project", key: projectKey(row.id), level, row });
      if (row.id !== input.expanded) continue;
      for (const tray of input.trayRows(row)) {
        out.push({ kind: "file", key: `f:${row.id}\n${tray.name}`, level: level + 1 + tray.depth, projectId: row.id, tray });
      }
    }
  }
  return out;
}
