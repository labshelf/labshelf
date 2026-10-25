/** Declares the project data operations that writing hosts run over project folders and the library's project registry. */
import type { PaperRecord } from "../../model/index.js";
import type { BacklinkMap } from "../citations/index.js";
import type { BibliographyUpdate, CitingProject } from "../citations/index.js";
import type { FigureState } from "../figures/index.js";
import type {
  FigureRecipe, OpenSources, ProjectEntry, ProjectFormat, ProjectSettingsUpdate,
} from "../project/index.js";
import type { ProjectTemplate, TemplateFile } from "../../templates/index.js";
import type { SynctexRead } from "../synctex/index.js";
import type { ProjectValueLeaf, ProjectValueSource } from "../projectValue/index.js";
import type { MarkVersionRequest, ProjectVersion } from "../versions/index.js";

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
