/** Declares the project data operations that writing hosts run over project folders and the library's project registry. */
import type { PaperRecord } from "../../model/index.js";
import type { BacklinkIndex } from "../backlinks/index.js";
import type { BibliographyUpdate, CitingProject } from "../citations/index.js";
import type { FigureState } from "../figures/index.js";
import type {
  FigureRecipe, OpenSources, ProjectEntry, ProjectFormat, ProjectSettingsPatch,
} from "../project/index.js";
import type { ProjectTemplate, TemplateFile } from "../templates/index.js";
import type { SynctexRead } from "../synctex/index.js";
import type { ValueLeaf, ValueProject } from "../values/index.js";
import type { MarkVersionRequest, ProjectVersion } from "../versions/index.js";

/** Paths are OS paths of the host; the implementation binds the logger. */
export interface ProjectDataPort {
  listProjects(libraryRoot: string): Promise<ProjectEntry[]>;
  createProjectFromTemplate(
    libraryRoot: string, request: { title: string; template: ProjectTemplate; files: readonly TemplateFile[] },
  ): Promise<ProjectEntry>;
  addExistingFolder(libraryRoot: string, request: { folder: string; format: ProjectFormat }): Promise<ProjectEntry>;
  unregisterProjectFolder(libraryRoot: string, folder: string): Promise<void>;
  /** Names of the files directly inside `folder`, for picking a main file. */
  rootFileNames(folder: string): Promise<string[]>;
  updateProjectSettings(folder: string, patch: ProjectSettingsPatch): Promise<void>;
  listVersions(folder: string): Promise<ProjectVersion[]>;
  /** Returns the folder of the marked version. */
  markVersion(request: MarkVersionRequest): Promise<string>;
  readProjectValues(project: Pick<ValueProject, "folder" | "settings">): Promise<ValueLeaf[]>;
  readFigureStates(folder: string, figures: Readonly<Record<string, FigureRecipe>>): Promise<Record<string, FigureState>>;
  updateProjectBibliography(project: CitingProject, papers: readonly PaperRecord[], open?: OpenSources): Promise<BibliographyUpdate>;
  projectBacklinks(projects: readonly ProjectEntry[], open?: OpenSources): Promise<BacklinkIndex>;
  /** The per-project build folder in the device cache; it depends on the host's environment. */
  projectBuildDir(projectId: string): string;
  /** Reads `<outDir>/<base>.synctex.gz`; `cwd` is the folder the build ran in. */
  readSynctexFile(outDir: string, base: string, cwd: string): Promise<SynctexRead>;
}
