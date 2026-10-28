// Maintains a page's project connection to the compilation helper: the open project's builds, its PDF and the build problems per file.
import { formatError } from "../errors/index.js";
import type { ILogger } from "../ports/index.js";
import type { BuildSchedule } from "../writing/build/index.js";
import type { LatexEngine, ProjectEntry } from "../writing/project/index.js";
import { createBuildScheduler, type BuildScheduler, type BuildTimers } from "./buildScheduler.js";
import type { HelperCompileResult, HelperState, ILatexHelper } from "./helperPaths.js";
import type { BuildKind } from "./helperMessages.js";
import { mergePdfPages } from "./pageMerge.js";

export type HelperProblem = HelperCompileResult["problems"][number];
type ProblemListener = (problems: readonly HelperProblem[]) => void;

interface ProblemStore {
  /** Calls `listener` at once with the file's current problems; returns the function that stops listening. */
  subscribe(path: string, listener: ProblemListener): () => void;
  /** Replaces every file's problems with those of `problems`; files without any get an empty list. */
  publish(problems: readonly HelperProblem[]): void;
}

function createProblemStore(): ProblemStore {
  let byFile = new Map<string, HelperProblem[]>();
  const listeners = new Map<string, Set<ProblemListener>>();
  return {
    subscribe(path, listener) {
      const set = listeners.get(path) ?? new Set<ProblemListener>();
      set.add(listener);
      listeners.set(path, set);
      listener(byFile.get(path) ?? []);
      return () => { set.delete(listener); };
    },
    publish(problems) {
      byFile = new Map();
      for (const problem of problems) {
        const list = byFile.get(problem.file) ?? [];
        list.push(problem);
        byFile.set(problem.file, list);
      }
      for (const [path, set] of listeners) {
        for (const listener of [...set]) listener(byFile.get(path) ?? []);
      }
    },
  };
}

export type BuildEvent =
  | { type: "building" }
  /** The changed PDF after a succeeded build; sent before that build's `result`. */
  | { type: "pdf"; bytes: Uint8Array; mode: BuildKind }
  | { type: "result"; result: HelperCompileResult; mode: BuildKind };

/** What a source editor needs from the helper, available only while its project is open there. */
export type EditorHelperPort = Pick<ILatexHelper, "status"> & {
  /** `explicit` when the user asked to save; under the "save" mode only such a save builds. */
  save(projectId: string, path: string, explicit?: boolean): Promise<void>;
  /** `line` is the 1-based line of the edit; it goes to the build scheduler, not to the helper's `edit` message. */
  edit(...args: [...Parameters<ILatexHelper["edit"]>, line?: number]): Promise<void>;
};

export interface HelperProject {
  status(): HelperState | undefined;
  /** Connects to the helper and opens the session's project there once it is ready. */
  connect(): Promise<HelperState>;
  /** The helper for the setup card: its `connect` also opens the session's project. */
  setupHelper: ILatexHelper;
  /** The helper while it is ready, else undefined. */
  helper(): ILatexHelper | undefined;
  isOpen(projectId: string): boolean;
  editorPort(projectId: string): EditorHelperPort;
  problems: Pick<ProblemStore, "subscribe">;
  /** The whole PDF of the latest succeeded full build of the open project, else undefined. */
  lastFullPdf(projectId: string): Uint8Array | undefined;
  /** Requests a full build after any active preview; its result arrives through `onBuild`. */
  build(projectId: string): Promise<void>;
  /** Applies a changed build setting to the open project; an engine or halt change rebuilds it. */
  setBuild(projectId: string, patch: BuildUpdate): void;
  onBuild(listener: (event: BuildEvent) => void): () => void;
  onOpened(listener: (projectId: string) => void): () => void;
  /** The session opened `entry`, or closed its project (undefined). */
  projectChanged(entry: ProjectEntry | undefined): Promise<void>;
}

interface BuildSettings { autoCompile: BuildSchedule; haltOnError: boolean }
type BuildUpdate = Partial<BuildSettings> & { engine?: LatexEngine };

export interface HelperProjectOptions {
  helper: ILatexHelper;
  logger: ILogger;
  /** Read each time a project opens, so the scheduler starts with the user's current settings. */
  buildSettings(): Promise<BuildSettings>;
  timers?: BuildTimers;
}

const MODULE = "helper.project";
type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;
interface PdfState { latest?: Uint8Array | undefined; full?: Uint8Array | undefined; queue: Promise<void>; closed: boolean }
const DEFAULT_BUILD: BuildSettings = { autoCompile: "typing", haltOnError: false };
interface OpenProject { id: string; scheduler: BuildScheduler | undefined; pdf: PdfState }

class HelperProjectSession {
  readonly store = createProblemStore();
  readonly buildListeners = new Set<(event: BuildEvent) => void>();
  readonly openedListeners = new Set<(projectId: string) => void>();
  private wanted: ReadyEntry | undefined;
  private open: OpenProject | undefined;
  private opening: ReadyEntry | undefined;

  constructor(private readonly options: HelperProjectOptions) {}
  isOpen(id: string): boolean { return this.open?.id === id; }
  lastFullPdf(id: string): Uint8Array | undefined { return this.isOpen(id) ? this.open?.pdf.full : undefined; }
  private emit(event: BuildEvent): void { for (const listener of [...this.buildListeners]) listener(event); }
  // INVARIANT: each result builds on the previous PDF, so results are assembled one at a time through `pdf.queue`.
  private async assemble(pdf: PdfState, projectId: string, main: string, result: HelperCompileResult, mode: BuildKind): Promise<void> {
    let outcome = result;
    if (result.status === "succeeded") {
      try {
        const started = Date.now();
        const previous = pdf.latest;
        pdf.latest = await mergePdfPages(pdf.latest, { pageCount: result.pageCount ?? 0, changed: result.changed });
        if (mode === "full") pdf.full = pdf.latest;
        if (!pdf.closed && pdf.latest !== previous) this.emit({ type: "pdf", bytes: pdf.latest, mode });
        void this.options.logger.log("INFO", MODULE, "Preview PDF assembled", { projectId, mode, changedPages: result.changed.length, reused: pdf.latest === previous, ms: Date.now() - started });
      } catch (error) {
        await this.options.logger.error(MODULE, error, { action: "assemble pdf", projectId, mode });
        const message = formatError(error);
        outcome = { status: "failed", changed: [], problems: [{ severity: "error", message, file: main }] };
      }
    }
    if (!pdf.closed) this.emit({ type: "result", result: outcome, mode });
  }

  private async buildSettings(projectId: string): Promise<BuildSettings> {
    try {
      return await this.options.buildSettings();
    } catch (error) {
      await this.options.logger.error(MODULE, error, { action: "read build settings", projectId });
      void this.options.logger.log("WARN", MODULE, "Building with the default build settings", { projectId, ...DEFAULT_BUILD });
      return DEFAULT_BUILD;
    }
  }

  private schedulerFor(entry: ReadyEntry, pdf: PdfState, { autoCompile, haltOnError }: BuildSettings): BuildScheduler | undefined {
    const { main } = entry;
    if (main === undefined) return undefined;
    const { id, engine } = entry.settings;
    return createBuildScheduler({
      onStart: () => {
        pdf.queue = pdf.queue.then(() => { if (!pdf.closed) this.emit({ type: "building" }); });
      },
      helper: this.options.helper, logger: this.options.logger, ...(this.options.timers ? { timers: this.options.timers } : {}),
      target: { projectId: id, main, haltOnError, ...(engine ? { engine } : {}) }, mode: autoCompile,
      onResult: (result, mode) => {
        if (result.status !== "cancelled") this.store.publish(result.problems);
        pdf.queue = pdf.queue.then(() => this.assemble(pdf, id, main, result, mode));
      },
    });
  }

  private async openWanted(): Promise<void> {
    const entry = this.wanted;
    // TRAP: the session reports one project again with a new entry (restore, then the records rebuild), so ids decide, not identity.
    if (entry === undefined || this.open?.id === entry.settings.id || this.opening?.settings.id === entry.settings.id) return;
    if (this.options.helper.status()?.state !== "ready") return;
    this.opening = entry;
    const id = entry.settings.id;
    try {
      await this.options.helper.openProject(id, entry.folder);
      const settings = await this.buildSettings(id);
      const latest = this.wanted;
      if (latest?.settings.id !== id) { await this.options.helper.closeProject(id); return; }
      const pdf: PdfState = { queue: Promise.resolve(), closed: false };
      this.open = { id, scheduler: this.schedulerFor(latest, pdf, settings), pdf };
      void this.options.logger.log("INFO", MODULE, "project opened in the helper", { projectId: id });
      for (const listener of [...this.openedListeners]) listener(id);
    } catch (error) {
      await this.options.logger.error(MODULE, error, { action: "open project in helper", projectId: id });
    } finally {
      this.opening = undefined;
    }
  }

  private async closeOpen(): Promise<void> {
    const closing = this.open;
    if (closing === undefined) return;
    this.open = undefined;
    closing.scheduler?.dispose();
    closing.pdf.closed = true;
    closing.pdf.full = undefined;
    this.store.publish([]);
    try {
      await this.options.helper.closeProject(closing.id);
    } catch (error) {
      await this.options.logger.error(MODULE, error, { action: "close project in helper", projectId: closing.id });
    }
  }

  async connect(): Promise<HelperState> {
    const status = await this.options.helper.connect();
    await this.openWanted();
    return status;
  }

  editorPort(id: string): EditorHelperPort {
    const { helper } = this.options;
    return {
      status: () => this.isOpen(id) ? helper.status() : undefined,
      edit: async (projectId, path, version, edit, line) => {
        if (!this.isOpen(id)) return;
        await helper.edit(projectId, path, version, edit);
        this.open?.scheduler?.edit(path, line);
      },
      save: async (projectId, path, explicit) => {
        if (!this.isOpen(id)) return;
        await helper.save(projectId, path);
        this.open?.scheduler?.save(explicit === true);
      },
    };
  }

  async build(id: string): Promise<void> {
    if (this.isOpen(id)) this.open?.scheduler?.build();
  }

  setBuild(id: string, { autoCompile, ...target }: BuildUpdate): void {
    const scheduler = this.isOpen(id) ? this.open?.scheduler : undefined;
    void this.options.logger.log("INFO", MODULE, scheduler ? "Build settings changed" : "Build settings changed; the next open reads them", { projectId: id, autoCompile, ...target });
    if (!scheduler) return;
    if (autoCompile !== undefined) scheduler.setMode(autoCompile);
    if (target.engine === undefined && target.haltOnError === undefined) return;
    scheduler.setTarget(target);
    scheduler.build();
  }

  async projectChanged(entry: ProjectEntry | undefined): Promise<void> {
    this.wanted = entry?.kind === "ready" ? entry : undefined;
    if (this.open !== undefined && this.open.id !== this.wanted?.settings.id) await this.closeOpen();
    if (this.wanted === undefined) return;
    try {
      if (this.options.helper.status() === undefined) await this.connect(); else await this.openWanted();
    } catch (error) {
      await this.options.logger.error(MODULE, error, { action: "connect to the helper" });
    }
  }
}

export function createHelperProject(options: HelperProjectOptions): HelperProject {
  const session = new HelperProjectSession(options);
  const { helper } = options;
  const connect = () => session.connect();
  return {
    status: () => helper.status(), connect, setupHelper: { ...helper, connect },
    helper: () => helper.status()?.state === "ready" ? helper : undefined,
    isOpen: (id) => session.isOpen(id), editorPort: (id) => session.editorPort(id), problems: session.store,
    lastFullPdf: (id) => session.lastFullPdf(id), build: (id) => session.build(id),
    setBuild: (id, patch) => session.setBuild(id, patch),
    onBuild(listener) { session.buildListeners.add(listener); return () => { session.buildListeners.delete(listener); }; },
    onOpened(listener) { session.openedListeners.add(listener); return () => { session.openedListeners.delete(listener); }; },
    projectChanged: (entry) => session.projectChanged(entry),
  };
}
