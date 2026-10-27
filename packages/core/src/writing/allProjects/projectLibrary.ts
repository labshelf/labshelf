// Implements the All projects page's storage port over the writing projects of a library, for any host, and declares what a host supplies.
import { formatError } from "../../errors/index.js";
import type { PdfjsLoader } from "../../import/index.js";
import type { PaperRecord } from "../../model/index.js";
import { isInside, type PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { ProjectEntry, ProjectSettingsUpdate, ProjectSubmission } from "../project/index.js";
import type { ProjectContentPort } from "../projectService.js";
import { createProjectPaneSource, type readProjectCitations, type readProjectPaneContent } from "./projectDetails.js";
import type { CreateProjectKind, ProjectLibraryPort, ProjectMenuCommand, ProjectPaneContent, ProjectRow, BuildMark, ProjectPlace } from "./projectModel.js";

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
  /** Replaces the core source readers; tests use it to count their calls. */
  readers?: Partial<ProjectSourceReaders> | undefined;
}

interface ProjectSourceReaders {
  citations: typeof readProjectCitations;
  paneContent: typeof readProjectPaneContent;
}

const placeOf = (entry: Extract<ProjectEntry, { kind: "ready" }>): ProjectPlace =>
  entry.settings.trashed ? "trash" : entry.settings.archived ? "archived" : "projects";

interface ProjectRowExtras {
  cites?: { cites: number; unresolved: number } | undefined;
  build?: BuildMark;
}

function deriveProjectRow(paths: PathOps, entry: ProjectEntry, modified: number | undefined, extras: ProjectRowExtras = {}): ProjectRow {
  const external = entry.location === "external";
  if (entry.kind === "broken") {
    return { id: entry.folder, title: paths.basename(entry.folder), place: "projects", external, broken: entry.reason };
  }
  const { settings } = entry;
  const { cites, build } = extras;
  return {
    id: entry.folder,
    title: settings.title ?? settings.id,
    format: settings.format,
    ...(entry.main ? { main: paths.relative(entry.folder, paths.resolve(entry.folder, entry.main)).split(paths.sep).join("/") } : {}),
    ...(settings.folder ? { folder: settings.folder } : {}),
    place: placeOf(entry),
    ...(modified !== undefined ? { modified } : {}),
    ...(settings.trashed ? { trashedAt: settings.trashed } : {}),
    ...(cites ? { cites: cites.cites, unresolvedCites: cites.unresolved } : {}),
    ...(build ? { build } : {}),
    ...(settings.target ? { target: settings.target } : {}),
    ...(settings.shared ? { shared: true } : {}),
    external,
  };
}

interface ProjectHostActionDeps extends Pick<ProjectLibraryDeps, "fs" | "paths" | "host" | "locate"> {
  /** Throws when the id is not a readable project of the library. */
  findReady(id: string): ReadyProject;
  openFile(id: string, file: string): Promise<void>;
  /** Writes the patch to the project's labshelf.yaml and reloads the project list. */
  edit(id: string, patch: { target: ProjectSubmission | null }): Promise<void>;
}

type HostActions = Pick<ProjectLibraryPort, "build" | "preview" | "openLog" | "createFile" | "setTarget">;

function createProjectHostActions(deps: ProjectHostActionDeps): HostActions {
  const { host, locate, paths, fs } = deps;
  const mainOf = (project: ReadyProject): string => {
    if (!project.main) { throw new Error(`${project.folder} has no main file`); }
    return project.main;
  };

  return {
    async build(id) {
      const project = deps.findReady(id);
      await host.build(project, mainOf(project));
    },
    preview: (id) => host.preview(deps.findReady(id)),
    async openLog(id) {
      const project = deps.findReady(id);
      const log = await locate.rawLog(project, mainOf(project));
      if (!log) { throw new Error(`No build log yet for ${project.folder}`); }
      await host.openLog(log);
    },
    async createFile(id, file) {
      const { folder } = deps.findReady(id);
      const target = paths.resolve(folder, file);
      // The page's parser already rejects these paths; the resolved path is checked again because it is what gets written.
      if (!isInside(paths, folder, target)) { throw new Error(`${file} is outside ${folder}`); }
      // TRAP: the port has no exclusive create, so a file that appears between this check and the write is overwritten.
      if (await fs.stat(target)) { throw new Error(`${file} already exists in ${folder}`); }
      try {
        await fs.ensureDir(paths.dirname(target));
        await fs.writeFile(target, new Uint8Array());
      } catch (error) {
        throw new Error(`${file} could not be created in ${folder}: ${formatError(error)}`);
      }
      await deps.openFile(id, file);
    },
    setTarget: (id, target) => deps.edit(id, { target }),
  };
}

export function createProjectLibrary(deps: ProjectLibraryDeps): ProjectLibraryPort {
  const { host, projects, session } = deps;
  const find = (id: string): ProjectEntry => findEntry(deps, id);
  const findReady = (id: string): ReadyProject => findReadyEntry(deps, id);
  const open = (id: string): Promise<void> => host.openProject(find(id));
  const openFile = async (id: string, file: string): Promise<void> => {
    const entry = findReady(id);
    if (!host.isOpen(entry)) { await host.openProject(entry); }
    await host.openFile(entry, file);
  };
  const edit = async (id: string, patch: ProjectSettingsUpdate): Promise<void> => {
    await projects.update(findReady(id).folder, patch);
    await projects.reload();
  };

  return {
    ...createRowsPort(deps),
    ...createProjectHostActions({ ...deps, findReady, openFile, edit }),
    openLabel: host.openLabel,
    commands: host.commands,
    newKinds: host.newKinds,
    open,
    create: host.createProject,
    rename: (id, title) => edit(id, { title: title === findReady(id).settings.id ? undefined : title }),
    duplicate: (id, title) => host.duplicate(findReady(id), title),
    move: (id, folder) => edit(id, { folder }),
    setArchived: (id, archived) => edit(id, { archived: archived || undefined }),
    setTrashed: (id, trashed) => edit(id, { trashed: trashed ? new Date().toISOString() : undefined }),
    async deleteForever(id) {
      const entry = find(id);
      const current = session();
      if (!current) { throw new Error("open a library before deleting a project"); }
      if (host.isOpen(entry)) { throw new Error("close the project before deleting it"); }
      await deps.data.deleteProjectForever(current.root, entry.folder);
      await current.logger.log("INFO", "writing.allProjects", "project deleted forever", { folder: entry.folder, location: entry.location });
      await projects.reload();
    },
    runCommand: (id, command) => host.runCommand(command, find(id)),
    files: (id) => deps.data.listProjectFiles(findReady(id).folder),
    openFile,
  };
}

function findEntry({ projects }: ProjectLibraryDeps, id: string): ProjectEntry {
  const entry = projects.find(id);
  if (!entry) { throw new Error(`project ${id} is not in the library`); }
  return entry;
}

function findReadyEntry(deps: ProjectLibraryDeps, id: string): ReadyProject {
  const entry = findEntry(deps, id);
  if (entry.kind !== "ready") { throw new Error(`project ${id} cannot be read: ${entry.reason}`); }
  return entry;
}

function createRowsPort(deps: ProjectLibraryDeps): Pick<ProjectLibraryPort, "list" | "detail" | "onDidChange"> {
  const { data, paths, projects, host } = deps;
  const details = createProjectPaneSource(deps);
  // Reading modification times walks each project's files, so a time is kept until the host reports a change.
  const modifiedTimes = new Map<string, Promise<number | undefined>>();
  const modified = (folder: string): Promise<number | undefined> => {
    let time = modifiedTimes.get(folder);
    if (!time) { time = data.lastModified(folder); modifiedTimes.set(folder, time); }
    return time;
  };
  return {
    async list(): Promise<ProjectRow[]> {
      return Promise.all(projects.list().map(async (entry) => {
        const time = await modified(entry.folder);
        if (entry.kind !== "ready") { return deriveProjectRow(paths, entry, time); }
        const [build, cites] = await Promise.all([details.build(entry), details.cites(entry, time)]);
        return deriveProjectRow(paths, entry, time, { build, cites });
      }));
    },
    detail: (id): Promise<ProjectPaneContent> => details.detail(findReadyEntry(deps, id)),
    onDidChange: (listener) => host.onChange(() => { modifiedTimes.clear(); listener(); }),
  };
}
