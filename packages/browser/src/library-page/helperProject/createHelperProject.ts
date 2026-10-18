// Connects the page to LabShelf Helper lazily and keeps the open project open there, with its builds and problems.
import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { CompileMode, HelperCompileResult, HelperStatus, ILatexHelper } from "@labshelf/core/helper";
import { createBuildScheduler, type BuildScheduler, type BuildTimers } from "../preview";
import { createLspChannel, type HelperLspChannel } from "./lspChannel";
import { createProblemStore, type ProblemStore } from "./problemStore";

const MODULE = "library-page.helperProject";

export type BuildEvent = { type: "building" } | { type: "result"; result: HelperCompileResult; mode: CompileMode };

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
interface OpenProject { id: string; scheduler: BuildScheduler | undefined }

export function createHelperProject({ helper, logger, timers }: HelperProjectOptions): HelperProject {
  const store = createProblemStore();
  const buildListeners = new Set<(event: BuildEvent) => void>();
  const openedListeners = new Set<(projectId: string) => void>();
  let wanted: ReadyEntry | undefined;
  let open: OpenProject | undefined;
  let opening: ReadyEntry | undefined;

  const emit = (event: BuildEvent): void => { for (const listener of [...buildListeners]) listener(event); };
  const isOpen = (id: string): boolean => open?.id === id;

  function schedulerFor(entry: ReadyEntry): BuildScheduler | undefined {
    if (entry.main === undefined) return undefined;
    const { id, engine } = entry.settings;
    return createBuildScheduler({
      helper, logger, ...(timers ? { timers } : {}),
      target: { projectId: id, main: entry.main, ...(engine ? { engine } : {}) },
      onResult(result, mode) {
        if (result.status !== "cancelled") store.publish(result.problems);
        emit({ type: "result", result, mode });
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
      open = { id, scheduler: schedulerFor(entry) };
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
