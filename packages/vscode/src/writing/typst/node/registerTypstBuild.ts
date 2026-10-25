// Registers the Node Typst builds, compiled by the extension's own compiler, behind the editor's live and on-save triggers.
import { ProjectBuildQueue } from "@labshelf/core/node";
import type * as vscode from "vscode";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { createProjectBuildDeps, type ProjectBuildDepsSource } from "../../build/node/index.js";
import { registerTypstTriggers } from "../index.js";
import { TypstBuilds, type TypstBuildsDeps } from "./typstBuilds.js";
import { createTypstCompilerHost } from "./typstCompilerHost.js";

interface TypstBuildRegistration extends Omit<TypstBuildsDeps, "queue" | "buildDeps"> {
  context: vscode.ExtensionContext;
  host: WritingHost;
  tex: ProjectBuildDepsSource["tex"];
  projects: WritingProjects;
  hasPreview: (projectFolder: string) => boolean;
}

/** Registers the triggers and returns the builds, which the Build Project command also uses. */
export function registerTypstBuild(deps: TypstBuildRegistration): TypstBuilds {
  const storageDir = deps.context.globalStorageUri.fsPath;
  const buildDeps = createProjectBuildDeps({ host: deps.host, projects: deps.projects, tex: deps.tex, typst: createTypstCompilerHost(storageDir) });
  const builds = new TypstBuilds({ ...deps, buildDeps, queue: new ProjectBuildQueue(buildDeps) });
  registerTypstTriggers({ ...deps, request: (folder, root, trigger) => builds.request(folder, root, trigger) });
  return builds;
}
