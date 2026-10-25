// Summarises a project's build in this session for All projects.
import type { ProjectBuildSummary } from "../projectDetailPane.js";
import type { BuildProblem, BuildSources, ReadyProject } from "./projectLibraryDeps.js";

function problemsOf({ builds }: BuildSources, folder: string): BuildProblem[] {
  return [...builds.builtRoots(folder)].flatMap((root) => builds.problemsOf(folder, root) ?? []);
}

export async function summariseBuild(sources: BuildSources, project: ReadyProject): Promise<ProjectBuildSummary> {
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
