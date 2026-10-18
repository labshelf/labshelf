// Answers the socket's project messages: open, close, edit and save against the library's project folders.
// CONTRACT: documents/contracts/helper.md#messages
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { PROTOCOL_VERSION, type ToHelperMessage } from "../../index.js";
import type { HelperHandler } from "../dispatch/index.js";
import type { LibraryProjects } from "./libraryProjects.js";

type MessageOf<T extends ToHelperMessage["type"]> = Extract<ToHelperMessage, { type: T }>;

export interface ProjectHandlerOptions {
  dataDir: string;
  projects: LibraryProjects;
  /** Drops the project's build state, so the next `pages` after open carries every page. */
  forgetBuilds(projectId: string): void;
  /** Tells the Typst language server an open document changed. */
  edited(projectId: string, path: string, version: number): Promise<void>;
  /** Stops the project's language server; its working copy is gone or no longer wanted. */
  stopServer(projectId: string): Promise<void>;
}

export type ProjectHandlers = Record<"openProject" | "closeProject" | "edit" | "save", HelperHandler>;

export function createProjectHandlers(options: ProjectHandlerOptions): ProjectHandlers {
  const { dataDir, projects, forgetBuilds, edited, stopServer } = options;
  return {
    async openProject(message, send) {
      const { id, projectId, root } = message as MessageOf<"openProject">;
      const { files } = await projects.open(projectId, root);
      forgetBuilds(projectId);
      await stopServer(projectId);
      // The build working copy of an earlier session may hold files the project no longer has.
      await fs.rm(path.join(dataDir, "projects", projectId, "src"), { recursive: true, force: true });
      send({ v: PROTOCOL_VERSION, id, type: "opened", projectId, files });
    },
    async closeProject(message, send) {
      const { id, projectId } = message as MessageOf<"closeProject">;
      await projects.close(projectId);
      forgetBuilds(projectId);
      await stopServer(projectId);
      send({ v: PROTOCOL_VERSION, id, type: "closed", projectId });
    },
    async edit(message) {
      const edit = message as MessageOf<"edit">;
      await projects.edit(edit.projectId, edit.path, edit.version, edit.text === undefined ? { changes: edit.changes } : { text: edit.text });
      await edited(edit.projectId, edit.path, edit.version);
    },
    async save(message) {
      const { projectId, path: file } = message as MessageOf<"save">;
      await projects.save(projectId, file);
    },
  };
}
