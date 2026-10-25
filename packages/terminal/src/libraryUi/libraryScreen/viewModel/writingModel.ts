/** Holds the writing projects listed in the Writing pane and the cursor over them. */
import * as path from "node:path";
import type { ProjectEntry } from "@labshelf/core";
import { listProjectsOnDisk } from "@labshelf/core/node";

import type { App } from "../app.js";

export class WritingModel {
  projects: ProjectEntry[] = [];
  index = 0;
  offset = 0;

  constructor(private readonly app: App) {}

  /** Reads the library's projects; a failure is logged and leaves the previous list in place. */
  async load(): Promise<void> {
    const { paths, logger } = this.app.ctx;
    try {
      const entries = await listProjectsOnDisk(paths.root, logger);
      this.projects = entries.filter((entry) => entry.kind !== "ready" || !entry.settings.trashed);
      this.index = Math.min(this.index, Math.max(0, this.projects.length - 1));
      this.app.scheduleRender();
    } catch (error) {
      await logger.error("writing", error, { operation: "list writing projects", root: paths.root });
    }
  }

  move(delta: number): void {
    this.index = Math.max(0, Math.min(this.index + delta, this.projects.length - 1));
  }

  moveTo(position: "top" | "bottom"): void {
    this.index = position === "top" ? 0 : Math.max(0, this.projects.length - 1);
  }
}

/** @returns the name shown for a project: its title, else its id, else the folder name of a broken one */
export function projectName(entry: ProjectEntry): string {
  return entry.kind === "ready" ? entry.settings.title ?? entry.settings.id : path.basename(entry.folder);
}
