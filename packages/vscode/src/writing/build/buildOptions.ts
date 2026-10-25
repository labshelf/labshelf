// Describes the build options a preview shows and writes the changes the user makes to them.
import * as vscode from "vscode";

import type { AutoCompileMode, BuildOptions, LatexEngine } from "@labshelf/core";
import type { ReadyProject } from "../buildRootDocument.js";
import { writeEngine, type WriteEngineDeps } from "./toolchain/index.js";
import { readAutoCompileMode } from "./buildMode.js";
import { shouldHaltOnError } from "./haltOnError.js";

const MODULE = "BuildOptions";

/** The engine is absent for Typst and null for a LaTeX project that has not chosen one (its first build asks). */
export function buildOptions(project: ReadyProject): Omit<BuildOptions, "includeOnly"> {
  const { settings } = project;
  return { autoCompile: readAutoCompileMode(), ...(settings.format === "latex" ? { engine: settings.engine ?? null, haltOnError: shouldHaltOnError() } : {}) };
}

export function setAutoCompile(mode: AutoCompileMode): Thenable<void> {
  return vscode.workspace.getConfiguration("labshelf.writing").update("autoCompile", mode, vscode.ConfigurationTarget.Global);
}

export function setHaltOnError(on: boolean): Thenable<void> {
  return vscode.workspace.getConfiguration("labshelf.writing").update("haltOnError", on, vscode.ConfigurationTarget.Global);
}

export async function setEngine(deps: WriteEngineDeps, project: ReadyProject, engine: LatexEngine): Promise<boolean> {
  const saved = await writeEngine(deps, project, engine);
  if (!saved) { void deps.host.current()?.logger.log("WARN", MODULE, `The ${engine} engine could not be saved for ${project.folder}.`, { engine, folder: project.folder }); }
  return saved;
}
