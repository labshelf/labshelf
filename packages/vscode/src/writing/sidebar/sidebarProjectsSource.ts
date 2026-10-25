// Lists the writing projects as sidebar rows and announces when any row's mark, count or tooltip may have changed.
import * as vscode from "vscode";

import {
  createBrokenProjectItem,
  createReadyProjectItem,
  updateProjectSettings,
  type ChecklistSignals,
  type ILogger,
  type ProjectEntry,
  type ProjectSettingsUpdate,
  type ReadingList,
  type ReadyEntry,
  type SidebarProjectItem,
  buildChecklist,
  type Counted,
} from "@labshelf/core";
import type { BuildOutcomes } from "../build/index.js";
import type { ReadyProject } from "../figures/index.js";
import type { WritingProjects } from "../session/index.js";

const MODULE = "writing/projects";
// Short enough to feel live, long enough that a build or a save burst costs one recount.
const DEBOUNCE_MS = 300;

interface ProjectCountsDeps {
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  logger: ILogger;
  readSignals: (project: ReadyEntry, logger: ILogger) => Promise<ChecklistSignals>;
  watchFolder: (folder: string, onChange: () => void) => vscode.Disposable;
  /** Called with the project whose count arrived or was dropped. */
  onChanged: (entry: ReadyEntry) => void;
}

function countOf(signals: ChecklistSignals): Counted {
  // The kind grouping never places items under sections, so the section lookups stay empty.
  const { openCount } = buildChecklist({
    ...signals, reading: [], pageOverflow: undefined,
    placeSection: (file) => ({ id: file, title: file, file }), citeSections: new Map(),
  }, "kind");
  return { open: openCount, stale: signals.staleFigures.length };
}

class ProjectCounts implements vscode.Disposable {
  private readonly pending = new Map<string, Promise<Counted | undefined>>();
  private readonly results = new Map<string, Counted>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private watchers: vscode.Disposable[] = [];
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: ProjectCountsDeps) {
    this.rewatch();
    this.subscription = deps.projects.onDidChange(() => this.rewatch());
  }

  /** The cached count, or undefined while it is being computed (or failed), which starts the computation once. */
  counted(entry: ReadyEntry): Counted | undefined {
    const known = this.results.get(entry.folder);
    if (!known) { void this.load(entry); }
    return known;
  }

  load(entry: ReadyEntry): Promise<Counted | undefined> {
    const existing = this.pending.get(entry.folder);
    if (existing) { return existing; }
    const started: Promise<Counted | undefined> = this.compute(entry).then((counted) => {
      // A recount started after a drop owns the folder's slot, so a stale result is discarded.
      if (counted && this.pending.get(entry.folder) === started) {
        this.results.set(entry.folder, counted);
        this.deps.onChanged(entry);
      }
      return counted;
    });
    this.pending.set(entry.folder, started);
    return started;
  }

  dispose(): void {
    this.subscription.dispose();
    this.disposeWatchers();
    for (const timer of this.timers.values()) { clearTimeout(timer); }
    this.timers.clear();
  }

  private async compute(entry: ReadyEntry): Promise<Counted | undefined> {
    try {
      return countOf(await this.deps.readSignals(entry, this.deps.logger));
    } catch (error) {
      await this.deps.logger.error(MODULE, error, { folder: entry.folder, action: "count open items" });
      return undefined;
    }
  }

  private drop(entry: ReadyEntry): void {
    this.pending.delete(entry.folder);
    this.results.delete(entry.folder);
    this.deps.onChanged(entry);
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) { watcher.dispose(); }
    this.watchers = [];
  }

  private rewatch(): void {
    this.disposeWatchers();
    for (const entry of this.deps.projects.list()) {
      if (entry.kind !== "ready") { continue; }
      this.watchers.push(this.deps.watchFolder(entry.folder, () => {
        clearTimeout(this.timers.get(entry.folder));
        this.timers.set(entry.folder, setTimeout(() => { this.timers.delete(entry.folder); this.drop(entry); }, DEBOUNCE_MS));
      }));
    }
  }
}

export interface SidebarProjectsSourceDeps {
  projects: Pick<WritingProjects, "list" | "onDidChange" | "reads">;
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
      if (entry.kind === "broken") { return createBrokenProjectItem(entry); }
      const reading = await this.deps.readingLists.of(entry);
      return createReadyProjectItem(entry, this.counts.counted(entry), this.deps.buildOutcomes.last(entry.folder), reading);
    }));
  }

  find(id: string): ProjectEntry | undefined {
    return this.deps.projects.list().find((entry) => entry.folder === id);
  }

  list(): readonly ProjectEntry[] {
    return this.deps.projects.list();
  }

  /** Rewrites a project's labshelf.yaml; the project list picks the change up on its next reload. */
  update(folder: string, patch: ProjectSettingsUpdate): Promise<void> {
    return updateProjectSettings(this.deps.projects.reads(this.deps.logger), folder, patch);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.counts.dispose();
    this.changeEmitter.dispose();
  }
}
