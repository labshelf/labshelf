// Tracks which built roots are stale: a source change after a successful build marks its PDF older than the sources.
import { isInside, type PathOps } from "../../path/index.js";

export interface SourceEvents {
  onSourceChanged(listener: (filePath: string) => void): { dispose(): void };
}

export interface StaleSourcesState {
  stale?: boolean;
  builtAt?: number;
}

interface RootRecord {
  builtAt?: number;
  stale: boolean;
  // INVARIANT: set when a source changes while a build runs, so that build's success cannot clear the change.
  changedSinceStart: boolean;
}

// Built outputs (.log, .aux, .pdf) are not sources: a build writes them and must not mark itself stale.
const SOURCE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".sty", ".cls"]);

export class StaleSources {
  private readonly roots = new Map<string, Map<string, RootRecord>>();
  private readonly subscription: { dispose(): void };

  /** `onStale` fires once when a built root turns stale, not on every later change. */
  constructor(private readonly paths: PathOps, events: SourceEvents, private readonly now: () => number, private readonly onStale: (folder: string, root: string) => void) {
    this.subscription = events.onSourceChanged((filePath) => this.changed(filePath));
  }

  building(folder: string, root: string): void {
    this.record(folder, root).changedSinceStart = false;
  }

  succeeded(folder: string, root: string): void {
    const record = this.record(folder, root);
    record.builtAt = this.now();
    record.stale = record.changedSinceStart;
    record.changedSinceStart = false;
  }

  failed(folder: string, root: string): void {
    this.record(folder, root).changedSinceStart = false;
  }

  statusOf(folder: string, root: string): StaleSourcesState {
    const record = this.roots.get(folder)?.get(root);
    return record?.builtAt === undefined ? {} : { stale: record.stale, builtAt: record.builtAt };
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private record(folder: string, root: string): RootRecord {
    const records = this.roots.get(folder) ?? new Map<string, RootRecord>();
    this.roots.set(folder, records);
    const record = records.get(root) ?? { stale: false, changedSinceStart: false };
    records.set(root, record);
    return record;
  }

  private changed(filePath: string): void {
    if (!SOURCE_EXTENSIONS.has(this.paths.extname(filePath))) { return; }
    for (const [folder, records] of this.roots) {
      if (!isInside(this.paths, folder, filePath)) { continue; }
      for (const [root, record] of records) {
        record.changedSinceStart = true;
        if (record.builtAt === undefined || record.stale) { continue; }
        record.stale = true;
        this.onStale(folder, root);
      }
    }
  }
}
