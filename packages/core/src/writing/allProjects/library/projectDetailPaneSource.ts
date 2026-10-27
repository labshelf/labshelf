// Reads the build summary, cites and detail of a project from the core readers for All projects.
import type { ProjectBuildReport, ProjectPaneContent } from "../projectDetailPane.js";
import { readProjectCitations } from "./readProjectCitationCounts.js";
import { readProjectPaneContent } from "./readProjectDetailPane.js";
import type { ProjectLibraryDeps, ReadyProject, BuildProblem, BuildSources } from "./projectLibraryDeps.js";
import { formatError } from "../../../errors/index.js";

function problemsOf({ builds }: BuildSources, folder: string): BuildProblem[] {
  return [...builds.builtRoots(folder)].flatMap((root) => builds.problemsOf(folder, root) ?? []);
}

export async function deriveBuildReport(sources: BuildSources, project: ReadyProject): Promise<ProjectBuildReport> {
  const { folder } = project;
  const problems = problemsOf(sources, folder).filter((problem) => problem.severity !== "info");
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warnings = problems.length - errors;
  const [head] = problems;
  const counts = { warnings, errors, ...(head ? { first: { message: head.message, ...(head.file ? { file: head.file } : {}), ...(head.line === undefined ? {} : { line: head.line }) } } : {}) };
  const outcome = sources.outcomes.last(folder);
  // A root's first build has no recorded problems yet, so the main root is checked as well as the built ones.
  const roots = new Set([...sources.builds.builtRoots(folder), ...(project.main ? [project.main] : [])]);
  const building = [...roots].some((root) => sources.builds.stateOf(folder, root)?.state === "building");
  if (building) { return { state: "building", ...(outcome ? { at: outcome.at.getTime() } : {}), ...counts }; }
  if (outcome) {
    const state = !outcome.ok ? "failed" : warnings > 0 ? "warnings" : "ok";
    return { state, at: outcome.at.getTime(), ...counts };
  }
  const modified = await sources.pdfModified(project);
  return modified === undefined ? { state: "never", ...counts } : { state: "earlier", at: modified, ...counts };
}

interface ProjectCites { cites: number; unresolved: number }

export interface ProjectPaneSource {
  build(project: ReadyProject): Promise<ProjectBuildReport>;
  /** Undefined when the sources cannot be read; the failure is logged. */
  cites(project: ReadyProject, modified: number | undefined): Promise<ProjectCites | undefined>;
  detail(project: ReadyProject): Promise<ProjectPaneContent>;
}

// The core readers take the main file from `settings.main`; the entry's main may be a detected one.
const withMain = (project: ReadyProject): ReadyProject["settings"] => ({ ...project.settings, ...(project.main ? { main: project.main } : {}) });

export function createProjectPaneSource(deps: ProjectLibraryDeps): ProjectPaneSource {
  const { fs, paths, logger, locate } = deps;
  const context = { fs, paths, logger };
  const pdfModified = async (project: ReadyProject): Promise<number | undefined> => {
    const pdf = await locate.pdf(project);
    return pdf === undefined ? undefined : (await fs.stat(pdf))?.mtimeMs;
  };
  const build = (project: ReadyProject): Promise<ProjectBuildReport> => deriveBuildReport({ ...deps, pdfModified }, project);
  // Reading the sources walks the project, so a count is kept until the project's modified time changes.
  const cached = new Map<string, { modified: number; value: ProjectCites }>();

  return {
    build,
    async cites(project, modified) {
      const hit = cached.get(project.folder);
      if (modified !== undefined && hit?.modified === modified) { return hit.value; }
      try {
        const { cites, unresolved } = await readProjectCitations(context, project.folder, withMain(project), await deps.listPapers());
        const value = { cites, unresolved };
        if (modified !== undefined) { cached.set(project.folder, { modified, value }); }
        return value;
      } catch (error) {
        await logger.log("WARN", "writing.allProjects", "could not read the cites of a project", {
          folder: project.folder, error: formatError(error),
        });
        return undefined;
      }
    },
    async detail(project) {
      const [papers, summary, pdf, log] = await Promise.all([
        deps.listPapers(), build(project), locate.pdf(project), project.main ? locate.rawLog(project, project.main) : undefined,
      ]);
      return readProjectPaneContent(context, {
        id: project.folder, folder: project.folder, settings: withMain(project), papers, build: summary, pdf, log, pdfjs: deps.pdfjs,
      });
    },
  };
}
