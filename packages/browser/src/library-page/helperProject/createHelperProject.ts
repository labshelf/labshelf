// Maintains the browser project's connection to the compilation helper.
import type { ProjectEntry } from "@labshelf/core";
import type { CompileMode, HelperCompileResult, HelperStatus } from "@labshelf/core/helper";
import { assemblePdf, createBuildScheduler, type BuildScheduler } from "../preview";
import { createProblemStore } from "./problemStore";
import type { BuildEvent, BuildPatch, BuildSettings, EditorHelperPort, HelperProject, HelperProjectOptions } from "./helperProjectTypes";

const MODULE = "library-page.helperProject";
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
  private async assemble(pdf: PdfState, projectId: string, main: string, result: HelperCompileResult, mode: CompileMode): Promise<void> {
    let outcome = result;
    if (result.status === "succeeded") {
      try {
        const started = Date.now();
        const previous = pdf.latest;
        pdf.latest = await assemblePdf(pdf.latest, { pageCount: result.pageCount ?? 0, changed: result.changed });
        if (mode === "full") pdf.full = pdf.latest;
        if (!pdf.closed && pdf.latest !== previous) this.emit({ type: "pdf", bytes: pdf.latest, mode });
        void this.options.logger.log("INFO", MODULE, "Preview PDF assembled", { projectId, mode, changedPages: result.changed.length, reused: pdf.latest === previous, ms: Date.now() - started });
      } catch (error) {
        await this.options.logger.error(MODULE, error, { action: "assemble pdf", projectId, mode });
        const message = error instanceof Error ? error.message : String(error);
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

  async connect(): Promise<HelperStatus> {
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

  setBuild(id: string, { autoCompile, ...target }: BuildPatch): void {
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
