// Reads the build summary, cites and detail of a project from the core readers for All projects.
import type { ProjectBuildSummary, ProjectDetail } from "../projectDetail.js";
import { readProjectCites, readProjectDetail } from "../read/index.js";
import { summariseBuild } from "./projectBuildState.js";
import type { ProjectLibraryDeps, ReadyProject } from "./projectLibraryDeps.js";

interface ProjectCites { cites: number; unresolved: number }

export interface ProjectDetailSource {
  build(project: ReadyProject): Promise<ProjectBuildSummary>;
  /** Undefined when the sources cannot be read; the failure is logged. */
  cites(project: ReadyProject, modified: number | undefined): Promise<ProjectCites | undefined>;
  detail(project: ReadyProject): Promise<ProjectDetail>;
}

// The core readers take the main file from `settings.main`; the entry's main may be a detected one.
const withMain = (project: ReadyProject): ReadyProject["settings"] => ({ ...project.settings, ...(project.main ? { main: project.main } : {}) });

export function createProjectDetailSource(deps: ProjectLibraryDeps): ProjectDetailSource {
  const { fs, paths, logger, locate } = deps;
  const context = { fs, paths, logger };
  const pdfModified = async (project: ReadyProject): Promise<number | undefined> => {
    const pdf = await locate.pdf(project);
    return pdf === undefined ? undefined : (await fs.stat(pdf))?.mtimeMs;
  };
  const build = (project: ReadyProject): Promise<ProjectBuildSummary> => summariseBuild({ ...deps, pdfModified }, project);
  // Reading the sources walks the project, so a count is kept until the project's modified time changes.
  const cached = new Map<string, { modified: number; value: ProjectCites }>();

  return {
    build,
    async cites(project, modified) {
      const hit = cached.get(project.folder);
      if (modified !== undefined && hit?.modified === modified) { return hit.value; }
      try {
        const { cites, unresolved } = await readProjectCites(context, project.folder, withMain(project), await deps.listPapers());
        const value = { cites, unresolved };
        if (modified !== undefined) { cached.set(project.folder, { modified, value }); }
        return value;
      } catch (error) {
        await logger.log("WARN", "writing.allProjects", "could not read the cites of a project", {
          folder: project.folder, error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    },
    async detail(project) {
      const [papers, summary, pdf, log] = await Promise.all([
        deps.listPapers(), build(project), locate.pdf(project), project.main ? locate.rawLog(project, project.main) : undefined,
      ]);
      return readProjectDetail(context, {
        id: project.folder, folder: project.folder, settings: withMain(project), papers, build: summary, pdf, log, pdfjs: deps.pdfjs,
      });
    },
  };
}
