// Implements the project data port with the neutral project functions over an injected library file system, and lists a project folder's entries as Files-tree rows.
import type { PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { ProjectTemplate, TemplateFile } from "../../templates/index.js";
import type { SidebarTreeNode } from "../../libraryUi/index.js";
import { deriveFileIcon } from "../../libraryUi/index.js";
import { deriveProjectBacklinks, updateProjectBibliography, type BacklinkMap, type BibliographyUpdate, type CitingProject } from "../citations/index.js";
import { readFigureBuildStates, type FigureState } from "../figures/index.js";
import { readSynctexFile, type SynctexRead } from "../synctex/index.js";
import { listVersions, addProjectVersion, type MarkVersionRequest, type ProjectVersion } from "../versions/index.js";
import type { ProjectEntry } from "./projectEntry.js";
import type { FigureRecipe, ProjectFormat, ProjectSettingsUpdate } from "./projectFile.js";
import {
  addExistingFolder, createProjectFromTemplate, removeProjectFolderForever, updateProjectSettings, type ProjectCatalogContext,
} from "./projectMutations.js";
import { createProjectFolderRegistry } from "./projectRegistry.js";
import {
  readLastModified, listProjectFiles, listProjects, listBuildRootFileNames, type OpenSources,
} from "./projectReads.js";
import { readProjectValues, type ProjectValueLeaf, type ProjectValueSource } from "./projectValues.js";

// --- The port ---

/** Paths are OS paths of the host; the implementation binds the logger. */
export interface ProjectContentPort {
  listProjects(libraryRoot: string): Promise<ProjectEntry[]>;
  createProjectFromTemplate(
    libraryRoot: string, request: { title: string; template: ProjectTemplate; files: readonly TemplateFile[] },
  ): Promise<ProjectEntry>;
  addExistingFolder(libraryRoot: string, request: { folder: string; format: ProjectFormat }): Promise<ProjectEntry>;
  unregisterProjectFolder(libraryRoot: string, folder: string): Promise<void>;
  /** Removes a library project's folder from disk; a registered external folder is only unregistered and its files stay. */
  deleteProjectForever(libraryRoot: string, folder: string): Promise<void>;
  /** The newest modification time (ms) among the project's source files, or undefined when it has none. */
  lastModified(folder: string): Promise<number | undefined>;
  /** Names of the files directly inside `folder`, for picking a main file. */
  rootFileNames(folder: string): Promise<string[]>;
  /** Every file of the project folder, relative to it, "/"-separated and sorted; hidden folders and node_modules are skipped. */
  listProjectFiles(folder: string): Promise<string[]>;
  updateProjectSettings(folder: string, patch: ProjectSettingsUpdate): Promise<void>;
  listVersions(folder: string): Promise<ProjectVersion[]>;
  /** Returns the folder of the marked version. */
  markVersion(request: MarkVersionRequest): Promise<string>;
  readProjectValues(project: Pick<ProjectValueSource, "folder" | "settings">): Promise<ProjectValueLeaf[]>;
  readFigureStates(folder: string, figures: Readonly<Record<string, FigureRecipe>>): Promise<Record<string, FigureState>>;
  updateProjectBibliography(project: CitingProject, papers: readonly PaperRecord[], open?: OpenSources): Promise<BibliographyUpdate>;
  projectBacklinks(projects: readonly ProjectEntry[], open?: OpenSources): Promise<BacklinkMap>;
  /** The per-project build folder in the device cache; it depends on the host's environment. */
  projectBuildDir(projectId: string): string;
  /** Reads `<outDir>/<base>.synctex.gz`; `cwd` is the folder the build ran in. */
  readSynctexFile(outDir: string, base: string, cwd: string): Promise<SynctexRead>;
}

// --- Device directories ---

export interface ProjectDeviceDirs {
  /** The list of project folders that live outside the library; a host with no device-local folder leaves it out and registers none. */
  readonly projectRegistryPath?: string | undefined;
  /** Holds one build folder per project id. */
  readonly buildCacheDir: string;
  /** Per project text file, the content last known to be common with other devices. */
  readonly mergeBasesDir: string;
}

// --- The implementation ---

export interface ProjectContentDeps {
  fs: LibraryFileSystem;
  path: PathOps;
  logger: ILogger;
  /** Read at every call: a host whose library root changes passes getters. */
  deviceDirs: ProjectDeviceDirs;
}

// A device without a registry path lists only the library's own projects and refuses to remember outside folders.
function registryOf(reads: Omit<ProjectCatalogContext, "registry">, deviceDirs: ProjectDeviceDirs): ProjectCatalogContext["registry"] {
  const filed = createProjectFolderRegistry(reads, () => deviceDirs.projectRegistryPath ?? "");
  const refuse = (): never => { throw new Error("This device keeps no project folder registry, so only projects inside the library can be used"); };
  const keeps = (): boolean => deviceDirs.projectRegistryPath !== undefined;
  return {
    folders: (root) => (keeps() ? filed.folders(root) : Promise.resolve([])),
    register: (root, folder) => (keeps() ? filed.register(root, folder) : refuse()),
    unregister: (root, folder) => (keeps() ? filed.unregister(root, folder) : Promise.resolve()),
  };
}

export function createProjectContent({ fs, path, logger, deviceDirs }: ProjectContentDeps): ProjectContentPort {
  const reads = { fs, paths: path, logger };
  // deviceDirs already names the current library's registry, so the root argument is not needed to locate it.
  const registry = registryOf(reads, deviceDirs);
  const catalog: ProjectCatalogContext = { ...reads, registry };
  return {
    listProjects: async (libraryRoot) => listProjects(reads, libraryRoot, await registry.folders(libraryRoot)),
    createProjectFromTemplate: (libraryRoot, request) => createProjectFromTemplate(catalog, libraryRoot, request),
    addExistingFolder: (libraryRoot, request) => addExistingFolder(catalog, libraryRoot, request),
    unregisterProjectFolder: (libraryRoot, folder) => registry.unregister(libraryRoot, folder),
    deleteProjectForever: (libraryRoot, folder) => removeProjectFolderForever(catalog, libraryRoot, folder),
    lastModified: (folder) => readLastModified(reads, folder),
    rootFileNames: (folder) => listBuildRootFileNames(reads, folder),
    listProjectFiles: (folder) => listProjectFiles(reads, folder),
    updateProjectSettings: (folder, patch) => updateProjectSettings(reads, folder, patch),
    listVersions: (folder) => listVersions(reads, folder),
    markVersion: (request) => addProjectVersion(reads, request),
    readProjectValues: (project) => readProjectValues(project, reads),
    readFigureStates: (folder, figures) => readFigureBuildStates(reads, folder, figures),
    updateProjectBibliography: (project, papers, open) => updateProjectBibliography(reads, project, papers, open),
    projectBacklinks: (projects, open) => deriveProjectBacklinks(reads, projects, open),
    projectBuildDir: (projectId) => path.join(deviceDirs.buildCacheDir, projectId),
    readSynctexFile: (outDir, base, cwd) => readSynctexFile(reads, outDir, base, cwd),
  };
}

// --- Files tree rows ---

/** An entry of a folder as read from disk. */
export interface DirEntry {
  name: string;
  folder: boolean;
}

/** folder: expands; source: a file of the project's format that is not the main file and can become it. */
export type ProjectFileKind = "folder" | "file" | "source";

export interface ProjectFileRow {
  kind: ProjectFileKind;
  node: SidebarTreeNode;
}

export interface ProjectFileContext {
  /** Undefined without an open project, where no file is a source. */
  format: ProjectFormat | undefined;
  /** The main file's path relative to the project folder, with "/" separators. */
  main: string | undefined;
}

// Build output lives in the cache, outside the project, so only these folders are not the user's sources.
const HIDDEN_NAMES = new Set([".git", ".labshelf"]);

/** The entries the Files tree shows: folders first, then by name. */
export function listVisibleEntries<T extends DirEntry>(entries: readonly T[]): T[] {
  return entries
    .filter(({ name }) => !HIDDEN_NAMES.has(name))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

const withoutDots = (path: string): string => path.split("/").filter((part) => part !== "" && part !== ".").join("/");

/** @param path the entry's path relative to the project folder, with "/" separators */
export function createProjectFileRow(path: string, folder: boolean, context: ProjectFileContext): ProjectFileRow {
  const name = path.split("/").pop() ?? path;
  if (folder) { return { kind: "folder", node: { key: path, label: name, icon: { kind: "glyph", name: "folder" }, children: [], open: false } }; }
  const main = context.main !== undefined && withoutDots(context.main) === path;
  const source = context.format !== undefined && name.toLowerCase().endsWith(context.format === "latex" ? ".tex" : ".typ");
  return {
    // A source of the project's format that is not already the main file can become it.
    kind: !main && source ? "source" : "file",
    node: { key: path, label: name, icon: deriveFileIcon(name), clickable: true, ...(main ? { description: "main" } : {}) },
  };
}
