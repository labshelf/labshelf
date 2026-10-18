// Registers the Node Typst builds, compiled by the extension's own compiler, behind the editor's live and on-save triggers.
import { ProjectBuildQueue } from "@labshelf/core/node";
import type * as vscode from "vscode";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { projectBuildDeps, type ProjectBuildDepsSource } from "../../build/node/index.js";
import { registerTypstTriggers } from "../typstTriggers.js";
import { TypstBuilds, type TypstBuildsDeps } from "./typstBuilds.js";
import { TypstCompilerHost } from "./typstCompilerHost.js";

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
  const buildDeps = projectBuildDeps({ host: deps.host, projects: deps.projects, tex: deps.tex, typst: new TypstCompilerHost(storageDir) });
  const builds = new TypstBuilds({ ...deps, buildDeps, queue: new ProjectBuildQueue(buildDeps) });
  registerTypstTriggers({ ...deps, request: (folder, root, trigger) => builds.request(folder, root, trigger) });
  return builds;
}
