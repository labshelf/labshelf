// Remembers, per project folder, the Checklist grouping and which of its groups are expanded.
import type * as vscode from "vscode";

import type { ChecklistGrouping } from "@labshelf/core";

interface ProjectMemory {
  grouping: ChecklistGrouping;
  expanded: Partial<Record<ChecklistGrouping, string[]>>;
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

  isExpanded(folder: string, grouping: ChecklistGrouping, groupId: string): boolean {
    return this.read(folder).expanded[grouping]?.includes(groupId) ?? false;
  }

  async setExpanded(folder: string, grouping: ChecklistGrouping, groupId: string, expanded: boolean): Promise<void> {
    const memory = this.read(folder);
    const others = (memory.expanded[grouping] ?? []).filter((id) => id !== groupId);
    await this.write(folder, { ...memory, expanded: { ...memory.expanded, [grouping]: expanded ? [...others, groupId] : others } });
  }

  private read(folder: string): ProjectMemory {
    return this.memento.get<ProjectMemory>(keyOf(folder)) ?? { grouping: "kind", expanded: {} };
  }

  private async write(folder: string, memory: ProjectMemory): Promise<void> {
    await this.memento.update(keyOf(folder), memory);
  }
}
