// Runs the All projects page's build, preview, log, new file and target actions on any project.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ProjectLibraryPort, ProjectSettingsPatch } from "@labshelf/core";
import type { ReadyProject } from "../mainDocument.js";
import { rawLogFile } from "../preview/index.js";
import type { WritingProjects } from "../session/index.js";

const SHOW_PREVIEW_COMMAND = "labshelf.writing.showPreview";

export interface ProjectHostActionDeps {
  projects: Pick<WritingProjects, "data" | "paths">;
  /** Throws when the id is not a readable project of the library. */
  findReady(id: string): ReadyProject;
  /** Saves the editors and builds one root of the project, as Build Project does. */
  recompile(folder: string, root: string): Promise<unknown>;
  open(id: string): Promise<void>;
  openFile(id: string, file: string): Promise<void>;
  /** Writes the patch to the project's labshelf.yaml and reloads the project list. */
  edit(id: string, patch: ProjectSettingsPatch): Promise<void>;
}

type HostActions = Pick<ProjectLibraryPort, "build" | "preview" | "openLog" | "createFile" | "setTarget">;

export function createProjectHostActions(deps: ProjectHostActionDeps): HostActions {
  const mainOf = (project: ReadyProject): string => {
    if (!project.main) { throw new Error(`${project.folder} has no main file`); }
    return project.main;
  };

  return {
    async build(id) {
      const project = deps.findReady(id);
      await deps.recompile(project.folder, mainOf(project));
    },
    async preview(id) {
      deps.findReady(id);
      await deps.open(id);
      await vscode.commands.executeCommand(SHOW_PREVIEW_COMMAND);
    },
    async openLog(id) {
      const project = deps.findReady(id);
      const log = await rawLogFile(deps.projects, project, mainOf(project));
      if (!log) { throw new Error(`No build log yet for ${project.folder}`); }
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(log));
    },
    async createFile(id, file) {
      const { folder } = deps.findReady(id);
      const target = path.resolve(folder, file);
      // The page's parser already rejects these paths; the resolved path is checked again because it is what gets written.
      const inside = path.relative(folder, target);
      if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) { throw new Error(`${file} is outside ${folder}`); }
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(target, "", { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") { throw new Error(`${file} already exists in ${folder}`); }
        throw new Error(`${file} could not be created in ${folder}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await deps.openFile(id, file);
    },
    setTarget: (id, target) => deps.edit(id, { target }),
  };
}
