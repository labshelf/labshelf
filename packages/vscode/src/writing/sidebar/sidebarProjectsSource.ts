// Lists the writing projects as sidebar rows and announces when any row's mark, count or tooltip may have changed.
import * as vscode from "vscode";

import type { ILogger, ProjectEntry, ReadingList } from "@labshelf/core";
import type { ChecklistSignals } from "@labshelf/core/node";
import type { SidebarProjectItem } from "../../ui/library/index.js";
import type { BuildOutcomes } from "../build/index.js";
import type { ReadyProject } from "../figures/index.js";
import type { WritingProjects } from "../session/index.js";
import { ProjectCounts } from "./projectCounts.js";
import { brokenProjectItem, readyProjectItem, type ReadyEntry } from "./sidebarProject.js";

export interface SidebarProjectsSourceDeps {
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  logger: ILogger;
  readSignals: (project: ReadyEntry, logger: ILogger) => Promise<ChecklistSignals>;
  readingLists: { of(project: ReadyProject): Promise<ReadingList> };
  buildOutcomes: Pick<BuildOutcomes, "last" | "onDidChange">;
  watchFolder: (folder: string, onChange: () => void) => vscode.Disposable;
}

export class SidebarProjectsSource implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly counts: ProjectCounts;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly deps: SidebarProjectsSourceDeps) {
    this.counts = new ProjectCounts({ ...deps, onChanged: () => this.changeEmitter.fire() });
    this.subscriptions = [
      deps.projects.onDidChange(() => this.changeEmitter.fire()),
      deps.buildOutcomes.onDidChange(() => this.changeEmitter.fire()),
    ];
  }

  /** Every project as a row; counts not yet known show as counting and arrive through `onDidChange`. */
  async rows(): Promise<SidebarProjectItem[]> {
    return Promise.all(this.deps.projects.list().map(async (entry) => {
      if (entry.kind === "broken") { return brokenProjectItem(entry); }
      const reading = await this.deps.readingLists.of(entry);
      return readyProjectItem(entry, this.counts.counted(entry), this.deps.buildOutcomes.last(entry.folder), reading);
    }));
  }

  find(id: string): ProjectEntry | undefined {
    return this.deps.projects.list().find((entry) => entry.folder === id);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.counts.dispose();
    this.changeEmitter.dispose();
  }
}
