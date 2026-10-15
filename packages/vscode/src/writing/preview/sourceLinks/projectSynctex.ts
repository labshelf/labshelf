// Reads a project's SyncTeX data once per build and keeps it until the next build replaces it.
import * as path from "node:path";

import type { SyncIndex } from "@labshelf/core";
import { projectBuildDir, readSynctexFile } from "@labshelf/core/node";
import type { ReadyProject } from "../../mainDocument.js";
import type { WritingHost } from "../../projectStore.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";

export type SynctexLookup =
  | { status: "found"; index: SyncIndex }
  | { status: "missing"; path: string }
  | { status: "unsupported" }
  | { status: "unreadable" };

export class ProjectSynctex {
  private readonly lookups = new Map<string, Promise<SynctexLookup>>();

  constructor(private readonly host: Pick<WritingHost, "current">) {}

  /** Forgets the project's data; the next lookup reads the file the latest build wrote. */
  invalidate(projectFolder: string): void {
    this.lookups.delete(projectFolder);
  }

  /** The project's data. A missing or unreadable file is not kept, so a later build is picked up. */
  load(project: ReadyProject): Promise<SynctexLookup> {
    const known = this.lookups.get(project.folder);
    if (known) { return known; }
    const pending = this.read(project);
    this.lookups.set(project.folder, pending);
    void pending.then((lookup) => {
      if (lookup.status !== "found" && this.lookups.get(project.folder) === pending) { this.lookups.delete(project.folder); }
    });
    return pending;
  }

  private async read(project: ReadyProject): Promise<SynctexLookup> {
    // Typst writes no SyncTeX; its compiler has no PDF-to-source map LabShelf can read.
    if (project.settings.format !== "latex") { return { status: "unsupported" }; }
    if (!project.main) { return { status: "missing", path: project.folder }; }
    const mainFile = path.join(project.folder, project.main);
    try {
      return await readSynctexFile(projectBuildDir(project.settings.id), path.basename(mainFile, path.extname(mainFile)), path.dirname(mainFile));
    } catch (error) {
      await this.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder });
      return { status: "unreadable" };
    }
  }
}
