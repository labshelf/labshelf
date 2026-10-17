// Reads the build summary, cites and detail of a project from the core readers for All projects.
import * as vscode from "vscode";
import type { ILogger, PaperRecord, PdfjsLoader, ProjectBuildSummary, ProjectDetail } from "@labshelf/core";
import { readProjectCites, readProjectDetail } from "@labshelf/core/node";
import type { ReadyProject } from "../mainDocument.js";
import { builtPdf, rawLogFile } from "../preview/index.js";
import type { WritingProjects } from "../session/index.js";
import { summariseBuild, type BuildSources } from "./projectBuildState.js";

export interface ProjectDetailDeps extends Pick<BuildSources, "outcomes" | "builds"> {
  projects: Pick<WritingProjects, "data" | "paths">;
  listPapers: () => Promise<PaperRecord[]>;
  logger: ILogger;
  pdfjs: PdfjsLoader;
}

export interface ProjectCites { cites: number; unresolved: number }

export interface ProjectDetailSource {
  build(project: ReadyProject): Promise<ProjectBuildSummary>;
  /** Undefined when the sources cannot be read; the failure is logged. */
  cites(project: ReadyProject, modified: number | undefined): Promise<ProjectCites | undefined>;
  detail(project: ReadyProject): Promise<ProjectDetail>;
}

// The core readers take the main file from `settings.main`; the entry's main may be a detected one.
const withMain = (project: ReadyProject): ReadyProject["settings"] => ({ ...project.settings, ...(project.main ? { main: project.main } : {}) });

export function createProjectDetailSource(deps: ProjectDetailDeps): ProjectDetailSource {
  const { projects, logger } = deps;
  const pdfModified = async (project: ReadyProject): Promise<number | undefined> => {
    const pdf = await builtPdf(projects, project, project.main);
    return pdf === undefined ? undefined : (await vscode.workspace.fs.stat(vscode.Uri.file(pdf))).mtime;
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
        const { cites, unresolved } = await readProjectCites(project.folder, withMain(project), await deps.listPapers());
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
        deps.listPapers(), build(project), builtPdf(projects, project, project.main),
        project.main ? rawLogFile(projects, project, project.main) : undefined,
      ]);
      return readProjectDetail({
        id: project.folder, folder: project.folder, settings: withMain(project), papers, build: summary, pdf, log, pdfjs: deps.pdfjs,
      }, logger);
    },
  };
}
