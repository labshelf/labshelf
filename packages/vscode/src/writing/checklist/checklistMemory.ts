// Remembers, per project folder, the Checklist grouping and which of its groups the user opened or closed.
import type * as vscode from "vscode";

import type { ChecklistGrouping } from "@labshelf/core";

type GroupIds = Partial<Record<ChecklistGrouping, string[]>>;

interface ProjectMemory {
  grouping: ChecklistGrouping;
  expanded: GroupIds;
  collapsed?: GroupIds;
}

const keyOf = (folder: string): string => `labshelf.writing.checklist:${folder}`;

export class ChecklistMemory {
  constructor(private readonly memento: vscode.Memento) {}

  grouping(folder: string): ChecklistGrouping {
    return this.read(folder).grouping;
  }

  async setGrouping(folder: string, grouping: ChecklistGrouping): Promise<void> {
    await this.write(folder, { ...this.read(folder), grouping });
  }

  /** @returns the user's last toggle of the group, else `byDefault` */
  isExpanded(folder: string, grouping: ChecklistGrouping, groupId: string, byDefault: boolean): boolean {
    const memory = this.read(folder);
    if (memory.expanded[grouping]?.includes(groupId)) { return true; }
    if (memory.collapsed?.[grouping]?.includes(groupId)) { return false; }
    return byDefault;
  }

  async setExpanded(folder: string, grouping: ChecklistGrouping, groupId: string, expanded: boolean): Promise<void> {
    const memory = this.read(folder);
    const without = (ids: GroupIds | undefined) => (ids?.[grouping] ?? []).filter((id) => id !== groupId);
    const open = without(memory.expanded);
    const closed = without(memory.collapsed);
    await this.write(folder, {
      ...memory,
      expanded: { ...memory.expanded, [grouping]: expanded ? [...open, groupId] : open },
      collapsed: { ...memory.collapsed, [grouping]: expanded ? closed : [...closed, groupId] },
    });
  }

  private read(folder: string): ProjectMemory {
    return this.memento.get<ProjectMemory>(keyOf(folder)) ?? { grouping: "kind", expanded: {} };
  }

  private async write(folder: string, memory: ProjectMemory): Promise<void> {
    await this.memento.update(keyOf(folder), memory);
  }
}
