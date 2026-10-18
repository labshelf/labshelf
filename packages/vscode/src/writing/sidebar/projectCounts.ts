// Counts the open checklist items of each ready project lazily, caches them per folder and drops a folder's count when its files change.
import { buildChecklist, type ChecklistSignals, type ILogger } from "@labshelf/core";
import * as vscode from "vscode";

import type { WritingProjects } from "../session/index.js";
import type { Counted, ReadyEntry } from "./sidebarProject.js";

const MODULE = "writing/projects";
// Short enough to feel live, long enough that a build or a save burst costs one recount.
const DEBOUNCE_MS = 300;

export interface ProjectCountsDeps {
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

export class ProjectCounts implements vscode.Disposable {
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
