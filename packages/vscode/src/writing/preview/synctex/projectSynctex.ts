// Reads a project's SyncTeX data once per build and keeps it until the next build replaces it.
import { rootBuildFolder, type PathOps, type ProjectDataPort, type SyncIndex } from "@labshelf/core";
import type { ReadyProject } from "../../buildRootDocument.js";
import type { WritingHost } from "../../session/index.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";

export type SynctexLookup =
  | { status: "found"; index: SyncIndex }
  | { status: "missing"; path: string }
  | { status: "unsupported" }
  | { status: "unreadable" };

export class ProjectSynctex {
  private readonly lookups = new Map<string, Promise<SynctexLookup>>();

  constructor(
    private readonly host: Pick<WritingHost, "current">,
    private readonly paths: PathOps,
    private readonly data: ProjectDataPort,
  ) {}

  /** Forgets the project's data; the next lookup reads the file the latest build wrote. */
  invalidate(projectFolder: string): void {
    this.lookups.delete(projectFolder);
  }

  /** The data of a root's build. A missing or unreadable file is not kept, so a later build is picked up. */
  load(project: ReadyProject, root: string | undefined): Promise<SynctexLookup> {
    const known = this.lookups.get(project.folder);
    if (known) { return known; }
    const pending = this.read(project, root);
    this.lookups.set(project.folder, pending);
    void pending.then((lookup) => {
      if (lookup.status !== "found" && this.lookups.get(project.folder) === pending) { this.lookups.delete(project.folder); }
    });
    return pending;
  }

  private async read(project: ReadyProject, root: string | undefined): Promise<SynctexLookup> {
    // Typst writes no SyncTeX; its compiler has no PDF-to-source map LabShelf can read.
    if (project.settings.format !== "latex") { return { status: "unsupported" }; }
    if (!root) { return { status: "missing", path: project.folder }; }
    const mainFile = this.paths.join(project.folder, root);
    try {
      const base = this.paths.basename(mainFile, this.paths.extname(mainFile));
      return await this.data.readSynctexFile(this.paths.join(this.data.projectBuildDir(project.settings.id), rootBuildFolder(root)), base, this.paths.dirname(mainFile));
    } catch (error) {
      await this.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder });
      return { status: "unreadable" };
    }
  }
}
