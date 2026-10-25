// Registers the LaTeX builds of the desktop: the core build queue behind the Build command and the build after each save.
import { ProjectBuildQueue, type ProjectBuildDeps } from "@labshelf/core/node";
import type * as vscode from "vscode";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import type { BuildPreviews } from "../../preview/index.js";
import type { BuildDiagnostics } from "../buildProblems.js";
import type { IncludeOnlyTarget } from "../includeOnly.js";
import { registerLatexSaveBuilds } from "../latexWriteBuilds.js";
import { registerLatexTypingSaves } from "../latexTypingWrites.js";
import { LatexBuilds } from "./latexBuilds.js";
import { projectBuildDeps } from "./projectBuildDeps.js";

interface LatexBuildDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  tex: ProjectBuildDeps["tex"];
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs" | "reload">;
  previews: Pick<BuildPreviews, "building" | "finished">;
  diagnostics: Pick<BuildDiagnostics, "publish">;
  /** The `\include` path a save builds alone while the preview's include-only toggle is on. */
  includeOnlyTarget?: IncludeOnlyTarget;
}

/** Registers the save builds and returns the builds, which the Build Project command also uses. */
export function registerLatexBuild(deps: LatexBuildDeps): LatexBuilds {
  const queue = new ProjectBuildQueue(projectBuildDeps({
    host: deps.host, projects: deps.projects, tex: deps.tex,
    // INVARIANT: this queue only builds LaTeX projects (the save builds pick LaTeX projects), so the Typst compiler is never requested.
    typst: { get: () => Promise.reject(new Error("The LaTeX build queue does not compile Typst projects.")) },
  }));
  const builds = new LatexBuilds({ host: deps.host, projects: deps.projects, queue, diagnostics: deps.diagnostics, previews: deps.previews });
  registerLatexSaveBuilds({
    context: deps.context, host: deps.host, projects: deps.projects,
    request: (folder, root, includeOnly) => builds.request(folder, root, "save", includeOnly),
    ...(deps.includeOnlyTarget && { includeOnlyTarget: deps.includeOnlyTarget }),
  });
  registerLatexTypingSaves({ context: deps.context, host: deps.host, projects: deps.projects });
  deps.context.subscriptions.push({ dispose: () => builds.cancelAll() });
  return builds;
}
