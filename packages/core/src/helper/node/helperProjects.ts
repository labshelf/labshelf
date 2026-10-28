// Keeps the helper's open projects: confined roots, versioned unsaved text, the file list, the TeX working copy and the library they open under.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ILogger } from "../../ports/index.js";
import { readSharedLibraryRoot } from "../../library/node/index.js";
import { BridgeError } from "../../bridge/index.js";
import { resolveInLibrary } from "../../bridge/node/index.js";
import { checkHelperPath } from "../helperPaths.js";
import {
  MAX_EDIT_CHANGES, MAX_OPEN_PROJECTS, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, type TextChange,
} from "../helperMessages.js";

// --- Error ---

/** Carries the helper protocol error code a project operation is refused with. */
export type HelperProjectErrorCode = "path" | "project-id" | "stale" | "limit" | "io" | "no-library";

export class HelperProjectError extends Error {
  constructor(readonly code: HelperProjectErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HelperProjectError";
  }
}

// --- State ---

interface UnsavedText { text: string; version: number }

/** What the helper keeps for one open project. */
interface OpenProject {
  /** Real, confined path of the project folder in the library. */
  root: string;
  unsaved: Map<string, UnsavedText>;
  /** What `syncWorkingCopy` last wrote into the working copy, by project path. */
  synced: Map<string, string>;
}

// --- Paths: the bridge's confinement, with its refusal mapped to the helper's `path` code ---

/** A confinement refusal becomes `path`; any other failure keeps its own error. */
async function resolveConfinedPath(root: string, relative: string): Promise<string> {
  try {
    return await resolveInLibrary(root, relative);
  } catch (error) {
    if (error instanceof BridgeError && error.code === "outsideLibrary") {
      throw new HelperProjectError("path", error.message, { cause: error });
    }
    throw error;
  }
}

function assertProjectPath(relative: string): string {
  const problem = checkHelperPath(relative);
  if (problem !== undefined) { throw new HelperProjectError("path", `Path "${relative}" is refused: ${problem}`); }
  return relative;
}

async function readProjectText(projectRoot: string, relative: string): Promise<string> {
  const file = await resolveConfinedPath(projectRoot, assertProjectPath(relative));
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    throw new HelperProjectError("io", `Could not read "${relative}"`, { cause: error });
  }
}

// --- File list ---

const SKIPPED_FOLDERS = new Set([".git", ".labshelf"]);

// INVARIANT: symlinks are skipped, so a listed path never leads outside the project.
/** Lists the regular files of a project folder as relative POSIX paths. @throws limit past the file cap; io when the folder cannot be read */
async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) {
        await walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        files.push(`${prefix}${entry.name}`);
        if (files.length > MAX_PROJECT_FILES) {
          throw new HelperProjectError("limit", `A project holds at most ${MAX_PROJECT_FILES} files`);
        }
      }
    }
  }
  try {
    await walk(root, "");
  } catch (error) {
    if (error instanceof HelperProjectError) { throw error; }
    throw new HelperProjectError("io", `Could not read project folder "${root}"`, { cause: error });
  }
  return files;
}

// --- Page edits: a whole-file text or ranges against the previous version ---

/** @throws stale when a range is outside the text or ranges overlap; limit past the changes cap */
function applyTextChanges(text: string, changes: readonly TextChange[]): string {
  if (changes.length > MAX_EDIT_CHANGES) {
    throw new HelperProjectError("limit", `An edit holds at most ${MAX_EDIT_CHANGES} changes`);
  }
  const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let cursor = 0;
  let out = "";
  for (const { from, to, insert } of ordered) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < cursor || to < from || to > text.length) {
      throw new HelperProjectError("stale", "A change does not fit the helper's text");
    }
    out += text.slice(cursor, from) + insert;
    cursor = to;
  }
  return out + text.slice(cursor);
}

export type ChangeBody = { text: string } | { changes: readonly TextChange[] };

/** @throws limit when the project, counting disk files and unsaved texts, would pass the file cap */
async function checkRoomForNewFile(project: OpenProject, relative: string): Promise<void> {
  const paths = new Set(await listProjectFiles(project.root));
  for (const path of project.unsaved.keys()) { paths.add(path); }
  paths.add(relative);
  if (paths.size > MAX_PROJECT_FILES) { throw new HelperProjectError("limit", `A project holds at most ${MAX_PROJECT_FILES} files`); }
}

async function applyChange(
  project: OpenProject,
  relative: string,
  version: number,
  body: ChangeBody,
  warn: (message: string, context: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  assertProjectPath(relative);
  await resolveConfinedPath(project.root, relative);
  if ("text" in body) {
    if (!project.unsaved.has(relative)) { await checkRoomForNewFile(project, relative); }
    project.unsaved.set(relative, { text: body.text, version });
    return;
  }
  const current = project.unsaved.get(relative);
  if (!current || current.version !== version - 1) {
    const helperVersion = current?.version ?? 0;
    await warn("Edit does not follow the helper's version", { path: relative, version, helperVersion });
    throw new HelperProjectError("stale", `Changes for "${relative}" do not follow version ${helperVersion}`);
  }
  project.unsaved.set(relative, { text: applyTextChanges(current.text, body.changes), version });
}

// --- Working copy ---

async function io<T>(action: string, file: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new HelperProjectError("io", `Could not ${action} "${file}" for the working copy`, { cause: error });
  }
}

/** Brings a project's TeX working copy up to date. Writes only into `srcDir`, never into the library; an unchanged file is not touched so latexmk reruns only what changed. */
async function syncWorkingCopy(project: OpenProject, srcDir: string): Promise<void> {
  const present = new Set<string>();
  let totalBytes = 0;
  const addBytes = (bytes: number) => {
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_BYTES) { throw new HelperProjectError("limit", `The project is larger than ${MAX_PROJECT_BYTES / (1024 * 1024)} MiB`); }
  };
  for (const file of await listProjectFiles(project.root)) {
    if (project.unsaved.has(file)) { continue; }
    present.add(file);
    const from = path.join(project.root, file);
    const to = path.join(srcDir, file);
    const { size, mtimeMs } = await io("read", from, () => fs.stat(from));
    addBytes(size);
    const signature = `file:${size}:${mtimeMs}`;
    if (project.synced.get(file) === signature) { continue; }
    await io("copy", from, async () => {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    });
    project.synced.set(file, signature);
  }
  for (const [file, { text, version }] of project.unsaved) {
    present.add(file);
    addBytes(Buffer.byteLength(text));
    const signature = `text:${version}`;
    if (project.synced.get(file) === signature) { continue; }
    const to = path.join(srcDir, file);
    await io("write", to, async () => {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, text);
    });
    project.synced.set(file, signature);
  }
  for (const [file] of [...project.synced]) {
    if (present.has(file)) { continue; }
    await io("remove", file, () => fs.rm(path.join(srcDir, file), { force: true }));
    project.synced.delete(file);
  }
}

// --- Open projects under one library root ---

const PROJECTS_MODULE = "helper/projects";

export interface HelperProjectsOptions { libraryRoot: string; logger: ILogger }

export interface HelperProjects {
  open(projectId: string, root: string): Promise<{ files: string[] }>;
  close(projectId: string): Promise<void>;
  edit(projectId: string, path: string, version: number, body: ChangeBody): Promise<void>;
  save(projectId: string, path: string): Promise<void>;
  textOf(projectId: string, path: string): Promise<string>;
  syncWorkingCopy(projectId: string, srcDir: string): Promise<void>;
}

export function createHelperProjects(options: HelperProjectsOptions): HelperProjects {
  const { libraryRoot, logger } = options;
  const projects = new Map<string, OpenProject>();

  const projectOf = (id: string): OpenProject => {
    const project = projects.get(id);
    if (!project) { throw new HelperProjectError("project-id", `Project "${id}" is not open`); }
    return project;
  };

  return {
    async open(projectId, root) {
      if (!projects.has(projectId) && projects.size >= MAX_OPEN_PROJECTS) {
        throw new HelperProjectError("limit", `At most ${MAX_OPEN_PROJECTS} projects can be open`);
      }
      const rootDir = await resolveConfinedPath(libraryRoot, root);
      const files = await listProjectFiles(rootDir);
      projects.set(projectId, { root: rootDir, unsaved: new Map(), synced: new Map() });
      await logger.log("INFO", PROJECTS_MODULE, "Project opened", { projectId, files: files.length });
      return { files };
    },

    async close(projectId) {
      projectOf(projectId);
      projects.delete(projectId);
      await logger.log("INFO", PROJECTS_MODULE, "Project closed", { projectId });
    },

    async edit(projectId, relative, version, body) {
      await applyChange(projectOf(projectId), relative, version, body, (message, context) => logger.log("WARN", PROJECTS_MODULE, message, { projectId, ...context }));
    },

    async save(projectId, relative) {
      const project = projectOf(projectId);
      project.unsaved.delete(assertProjectPath(relative));
    },

    async textOf(projectId, relative) {
      const project = projectOf(projectId);
      return project.unsaved.get(assertProjectPath(relative))?.text ?? readProjectText(project.root, relative);
    },

    async syncWorkingCopy(projectId, srcDir) {
      await syncWorkingCopy(projectOf(projectId), srcDir);
    },
  };
}

// --- Projects under the library root the shared configuration names when each project opens ---
// CONTRACT: documents/contracts/helper.md#messages

const LIBRARY_MODULE = "helper/libraryProjects";

export interface LibraryProjectsOptions {
  /** The shared configuration file; the platform's default when absent. */
  sharedConfigFile?: string;
  logger: ILogger;
}

export interface LibraryProjects extends HelperProjects {
  closeAll(): Promise<void>;
}

export function createLibraryProjects(options: LibraryProjectsOptions): LibraryProjects {
  const { logger } = options;
  let current: { root: string; projects: HelperProjects } | undefined;
  const open = new Set<string>();

  const closeAll = async () => {
    for (const id of [...open]) { await current?.projects.close(id); }
    open.clear();
  };

  // INVARIANT: every open project belongs to `current`, so a changed library root first closes them all.
  async function projectsFor(): Promise<HelperProjects> {
    const root = await readSharedLibraryRoot(options.sharedConfigFile, logger);
    if (!root) { throw new HelperProjectError("no-library", "No library folder is set up on this computer"); }
    if (current?.root !== root) {
      if (current) { await logger.log("INFO", LIBRARY_MODULE, "Library root changed; closing open projects", { from: current.root, to: root, open: open.size }); }
      await closeAll();
      current = { root, projects: createHelperProjects({ libraryRoot: root, logger }) };
    }
    return current.projects;
  }

  const owner = (projectId: string): HelperProjects => {
    if (!current || !open.has(projectId)) { throw new HelperProjectError("project-id", `Project "${projectId}" is not open`); }
    return current.projects;
  };

  return {
    async open(projectId, root) {
      const result = await (await projectsFor()).open(projectId, root);
      open.add(projectId);
      return result;
    },
    async close(projectId) {
      await owner(projectId).close(projectId);
      open.delete(projectId);
    },
    edit: (projectId, path, version, body) => owner(projectId).edit(projectId, path, version, body),
    save: (projectId, path) => owner(projectId).save(projectId, path),
    textOf: (projectId, path) => owner(projectId).textOf(projectId, path),
    syncWorkingCopy: (projectId, srcDir) => owner(projectId).syncWorkingCopy(projectId, srcDir),
    closeAll,
  };
}
