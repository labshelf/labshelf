// Declares what a host supplies to the All projects library: the project list, disk, build state and editor actions.
import type { PdfjsLoader } from "../../../import/index.js";
import type { PathOps } from "../../../path/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger, LibraryFileSystem } from "../../../ports/index.js";
import type { ProjectContentPort, ProjectEntry, ProjectSettingsUpdate } from "../../project/index.js";
import type { CreateProjectKind, ProjectMenuCommand } from "../projectRow.js";

export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

export interface BuildProblem {
  severity: "error" | "warning" | "info";
  message: string;
  file?: string | undefined;
  line?: number | undefined;
}

/** What the library reads of the builds a host has run in this session. */
export interface BuildSources {
  outcomes: { last(folder: string): { ok: boolean; at: Date } | undefined };
  builds: {
    builtRoots(folder: string): Iterable<string>;
    problemsOf(folder: string, root: string): readonly BuildProblem[] | undefined;
    stateOf(folder: string, root: string): { state: string } | undefined;
  };
  /** The modification time of the main root's built PDF, when it exists. */
  pdfModified(project: ReadyProject): Promise<number | undefined>;
}

/** The editor actions of the host; each receives the project it acts on. */
export interface ProjectHostFunctions {
  openProject(entry: ProjectEntry): Promise<void>;
  createProject(kind: CreateProjectKind): Promise<void>;
  openFile(entry: ReadyProject, file: string): Promise<void>;
  /** Saves the editors and builds one root of the project. */
  build(entry: ReadyProject, root: string): Promise<void>;
  /** Shows the project's last PDF, opening the project first when needed. */
  preview(entry: ReadyProject): Promise<void>;
  openLog(path: string): Promise<void>;
  duplicate(entry: ReadyProject, title: string): Promise<void>;
  runCommand(command: string, entry: ProjectEntry): Promise<void>;
  commands(): ProjectMenuCommand[];
  newKinds(): CreateProjectKind[];
  openLabel(): string;
  /** Whether the project is the one open in the host; it cannot be deleted. */
  isOpen(entry: ProjectEntry): boolean;
  /** Fires when the project list or a build changes; returns the function that stops listening. */
  onChange(listener: () => void): () => void;
}

export interface ProjectLibraryDeps {
  data: Pick<ProjectContentPort, "lastModified" | "deleteProjectForever" | "listProjectFiles">;
  fs: LibraryFileSystem;
  paths: PathOps;
  logger: ILogger;
  /** The open library, or undefined when none is open. */
  session(): { root: string; logger: ILogger } | undefined;
  projects: {
    find(folder: string): ProjectEntry | undefined;
    list(): readonly ProjectEntry[];
    /** Writes the patch to the project's labshelf.yaml. */
    update(folder: string, patch: ProjectSettingsUpdate): Promise<void>;
    reload(): Promise<void>;
  };
  outcomes: BuildSources["outcomes"];
  builds: BuildSources["builds"];
  listPapers(): Promise<PaperRecord[]>;
  pdfjs: PdfjsLoader;
  /** Where the host keeps the files a build leaves; undefined when there is none yet. */
  locate: {
    pdf(project: ReadyProject): Promise<string | undefined>;
    rawLog(project: ReadyProject, root: string): Promise<string | undefined>;
  };
  host: ProjectHostFunctions;
}
