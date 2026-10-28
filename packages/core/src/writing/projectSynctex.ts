// Reads a project's SyncTeX data once per build and keeps it until the next build replaces it.
import type { ILogger } from "../ports/index.js";
import type { PathOps } from "../path/index.js";
import type { ReadyProject } from "./project/index.js";
import { deriveBuildRootFolder } from "./project/index.js";
import type { ProjectContentPort } from "./projectService.js";
import type { SynctexMap } from "./synctexFile.js";

/** The log module of the build preview; the same string as the VS Code preview panel logs under. */
export const PREVIEW_LOG_MODULE = "writing/preview";

/** The session whose logger records an unreadable SyncTeX file, when one is open. */
export interface SynctexLogHost {
  current(): { logger: ILogger } | undefined;
}

/** What the SyncTeX data of a project's build holds, or why it cannot be had. */
export type SynctexFinder =
  | { status: "found"; index: SynctexMap }
  | { status: "missing"; path: string }
  | { status: "unsupported" }
  | { status: "unreadable" };

/** Reads a project's SyncTeX data once per build and keeps it until the next build replaces it. */
export class ProjectSynctex {
  private readonly lookups = new Map<string, Promise<SynctexFinder>>();

  constructor(
    private readonly host: SynctexLogHost,
    private readonly paths: PathOps,
    private readonly data: ProjectContentPort,
  ) {}

  /** Forgets the project's data; the next lookup reads the file the latest build wrote. */
  invalidate(projectFolder: string): void {
    this.lookups.delete(projectFolder);
  }

  /** The data of a root's build. A missing or unreadable file is not kept, so a later build is picked up. */
  load(project: ReadyProject, root: string | undefined): Promise<SynctexFinder> {
    const known = this.lookups.get(project.folder);
    if (known) { return known; }
    const pending = this.read(project, root);
    this.lookups.set(project.folder, pending);
    void pending.then((lookup) => {
      if (lookup.status !== "found" && this.lookups.get(project.folder) === pending) { this.lookups.delete(project.folder); }
    });
    return pending;
  }

  private async read(project: ReadyProject, root: string | undefined): Promise<SynctexFinder> {
    // Typst writes no SyncTeX; its compiler has no PDF-to-source map LabShelf can read.
    if (project.settings.format !== "latex") { return { status: "unsupported" }; }
    if (!root) { return { status: "missing", path: project.folder }; }
    const mainFile = this.paths.join(project.folder, root);
    try {
      const base = this.paths.basename(mainFile, this.paths.extname(mainFile));
      return await this.data.readSynctexFile(this.paths.join(this.data.projectBuildDir(project.settings.id), deriveBuildRootFolder(root)), base, this.paths.dirname(mainFile));
    } catch (error) {
      await this.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder });
      return { status: "unreadable" };
    }
  }
}
