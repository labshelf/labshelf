// Defines the browser project connection exposed to source editors and preview tabs.
import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { CompileMode, HelperCompileResult, HelperStatus, ILatexHelper } from "@labshelf/core/helper";
import type { BuildTimers } from "../preview";
import type { ProblemStore } from "./problemStore";

export type BuildEvent =
  | { type: "building" }
  /** The changed PDF after a succeeded build; sent before that build's `result`. */
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
  problems: Pick<ProblemStore, "subscribe">;
  /** The whole PDF of the latest succeeded full build of the open project, else undefined. */
  lastFullPdf(projectId: string): Uint8Array | undefined;
  /** Requests a full build after any active preview; its result arrives through `onBuild`. */
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

