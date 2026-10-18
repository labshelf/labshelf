// Connects the page to LabShelf Helper lazily and keeps the open project open there, with its builds and problems.
import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { CompileMode, HelperCompileResult, HelperStatus, ILatexHelper } from "@labshelf/core/helper";
import { assemblePdf, createBuildScheduler, type BuildScheduler, type BuildTimers } from "../preview";
import { createLspChannel, type HelperLspChannel } from "./lspChannel";
import { createProblemStore, type ProblemStore } from "./problemStore";

const MODULE = "library-page.helperProject";

export type BuildEvent =
  | { type: "building" }
  /** The whole PDF after a succeeded build; always sent before that build's `result`. */
  | { type: "pdf"; bytes: Uint8Array; mode: CompileMode }
  | { type: "result"; result: HelperCompileResult; mode: CompileMode };

/** What a source editor needs from the helper, available only while its project is open there. */
export type EditorHelperPort = Pick<ILatexHelper, "status" | "save"> & {
  /** `line` is the 1-based line of the edit; it goes to the build scheduler, not to the helper's `edit` message. */
  edit(...args: [...Parameters<ILatexHelper["edit"]>, line?: number]): Promise<void>;
};

export interface HelperProject {
  status(): HelperStatus | undefined;
  /** Connects to the helper and opens the session's project there once it is ready. */
  connect(): Promise<HelperStatus>;
  /** The helper for the setup card: its `connect` also opens the session's project. */
  setupHelper: ILatexHelper;
  /** The helper while it is ready, else undefined. */
  helper(): ILatexHelper | undefined;
  isOpen(projectId: string): boolean;
  editorPort(projectId: string): EditorHelperPort;
  lsp(projectId: string): HelperLspChannel;
  problems: Pick<ProblemStore, "subscribe">;
  /** The whole PDF of the latest succeeded full build of the open project, else undefined. */
  lastFullPdf(projectId: string): Uint8Array | undefined;
  /** Starts a full build now; resolves once it has started, and its result arrives through `onBuild`. */
  build(projectId: string): Promise<void>;
  onBuild(listener: (event: BuildEvent) => void): () => void;
  onOpened(listener: (projectId: string) => void): () => void;
  /** The session opened `entry`, or closed its project (undefined). */
  projectChanged(entry: ProjectEntry | undefined): Promise<void>;
}

export interface HelperProjectOptions {
  helper: ILatexHelper;
  logger: ILogger;
  timers?: BuildTimers;
}

type ReadyEntry = Extract<ProjectEntry, { kind: "ready" }>;
interface PdfState { latest?: Uint8Array | undefined; full?: Uint8Array | undefined; queue: Promise<void>; closed: boolean }
interface OpenProject { id: string; scheduler: BuildScheduler | undefined; pdf: PdfState }

export function createHelperProject({ helper, logger, timers }: HelperProjectOptions): HelperProject {
  const store = createProblemStore();
  const buildListeners = new Set<(event: BuildEvent) => void>();
  const openedListeners = new Set<(projectId: string) => void>();
  let wanted: ReadyEntry | undefined;
  let open: OpenProject | undefined;
  let opening: ReadyEntry | undefined;

  const emit = (event: BuildEvent): void => { for (const listener of [...buildListeners]) listener(event); };
  const isOpen = (id: string): boolean => open?.id === id;

  // INVARIANT: each result builds on the previous PDF, so results are assembled one at a time through `pdf.queue`.
  async function assemble(pdf: PdfState, projectId: string, main: string, result: HelperCompileResult, mode: CompileMode): Promise<void> {
    let outcome = result;
    if (result.status === "succeeded") {
      try {
        pdf.latest = await assemblePdf(pdf.latest, { pageCount: result.pageCount ?? 0, changed: result.changed });
        if (mode === "full") pdf.full = pdf.latest;
        if (!pdf.closed) emit({ type: "pdf", bytes: pdf.latest, mode });
      } catch (error) {
        await logger.error(MODULE, error, { action: "assemble pdf", projectId, mode });
        const message = error instanceof Error ? error.message : String(error);
        outcome = { status: "failed", changed: [], problems: [{ severity: "error", message, file: main }] };
      }
    }
    if (!pdf.closed) emit({ type: "result", result: outcome, mode });
  }

  function schedulerFor(entry: ReadyEntry, pdf: PdfState): BuildScheduler | undefined {
    const { main } = entry;
    if (main === undefined) return undefined;
    const { id, engine } = entry.settings;
    return createBuildScheduler({
      helper, logger, ...(timers ? { timers } : {}),
      target: { projectId: id, main, ...(engine ? { engine } : {}) },
      onResult(result, mode) {
        if (result.status !== "cancelled") store.publish(result.problems);
        pdf.queue = pdf.queue.then(() => assemble(pdf, id, main, result, mode));
      },
    });
  }

  async function openWanted(): Promise<void> {
    const entry = wanted;
    if (entry === undefined || open?.id === entry.settings.id || opening === entry) return;
    if (helper.status()?.state !== "ready") return;
    opening = entry;
    const id = entry.settings.id;
    try {
      await helper.openProject(id, entry.folder);
      if (wanted !== entry) { await helper.closeProject(id); return; }
      const pdf: PdfState = { queue: Promise.resolve(), closed: false };
      open = { id, scheduler: schedulerFor(entry, pdf), pdf };
      void logger.log("INFO", MODULE, "project opened in the helper", { projectId: id });
      for (const listener of [...openedListeners]) listener(id);
    } catch (error) {
      await logger.error(MODULE, error, { action: "open project in helper", projectId: id });
    } finally {
      opening = undefined;
    }
  }

  async function closeOpen(): Promise<void> {
    const closing = open;
    if (closing === undefined) return;
    open = undefined;
    closing.scheduler?.dispose();
    closing.pdf.closed = true;
    closing.pdf.full = undefined;
    store.publish([]);
    try {
      await helper.closeProject(closing.id);
    } catch (error) {
      await logger.error(MODULE, error, { action: "close project in helper", projectId: closing.id });
    }
  }

  async function connect(): Promise<HelperStatus> {
    const status = await helper.connect();
    await openWanted();
    return status;
  }

  const onOpened = (listener: (projectId: string) => void): (() => void) => {
    openedListeners.add(listener);
    return () => { openedListeners.delete(listener); };
  };

  const port = (id: string): EditorHelperPort => ({
    status: () => (isOpen(id) ? helper.status() : undefined),
    async edit(projectId, path, version, edit, line) {
      if (!isOpen(id)) return;
      await helper.edit(projectId, path, version, edit);
      open?.scheduler?.edit(path, line);
      emit({ type: "building" });
    },
    async save(projectId, path) {
      if (!isOpen(id)) return;
      await helper.save(projectId, path);
      open?.scheduler?.save();
      emit({ type: "building" });
    },
  });

  return {
    status: () => helper.status(),
    connect,
    setupHelper: { ...helper, connect },
    helper: () => (helper.status()?.state === "ready" ? helper : undefined),
    isOpen,
    editorPort: port,
    lsp: (id) => createLspChannel({ helper, isOpen, onOpened }, id),
    problems: store,
    lastFullPdf: (id) => (isOpen(id) ? open?.pdf.full : undefined),
    async build(id) {
      if (!isOpen(id) || open?.scheduler === undefined) return;
      open.scheduler.save();
      emit({ type: "building" });
    },
    onBuild(listener) { buildListeners.add(listener); return () => { buildListeners.delete(listener); }; },
    onOpened,
    async projectChanged(entry) {
      wanted = entry?.kind === "ready" ? entry : undefined;
      if (open !== undefined && open.id !== wanted?.settings.id) await closeOpen();
      if (wanted === undefined) return;
      try {
        if (helper.status() === undefined) await connect(); else await openWanted();
      } catch (error) {
        await logger.error(MODULE, error, { action: "connect to the helper" });
      }
    },
  };
}
