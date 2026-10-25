// Defines the browser project connection exposed to source editors and preview tabs.
import type { BuildSchedule, ILogger, LatexEngine, ProjectEntry } from "@labshelf/core";
import type { BuildKind, HelperCompileResult, HelperState, ILatexHelper } from "@labshelf/core/helper";
import type { BuildTimers } from "../../writing/preview";
import type { ProblemStore } from "./problemStore";

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

export interface BuildSettings { autoCompile: BuildSchedule; haltOnError: boolean }
export type BuildUpdate = Partial<BuildSettings> & { engine?: LatexEngine };

export interface HelperProjectOptions {
  helper: ILatexHelper;
  logger: ILogger;
  /** Read each time a project opens, so the scheduler starts with the user's current settings. */
  buildSettings(): Promise<BuildSettings>;
  timers?: BuildTimers;
}

