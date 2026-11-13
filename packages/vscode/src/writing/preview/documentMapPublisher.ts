// Sends each open preview the document map of the root it shows: headings with included files expanded, the review and content marks,
// and their PDF points from the build's SyncTeX data. Sent again after a build, a source edit or a change to the project's comments.
import * as vscode from "vscode";

import {
  buildDocumentMap, COMMENTS_PATH, deriveCommentThreads, deriveSuggestions, findPagePoint, parseCommentsQmd,
  type DocumentMap, type ProjectSynctex,
} from "@labshelf/core";
import { createProjectSourceReader } from "../../latex/index.js";
import type { ReadyProject } from "../projects/index.js";
import { PREVIEW_LOG_MODULE, type BuildPreviewsDeps } from "./panel.js";

// An edit is sent once typing pauses; the map reads every included file.
const EDIT_DELAY_MS = 800;

export interface DocumentMapPublisherState {
  /** The readers showing a project's preview. */
  readers: { of(folder: string): ReadonlyArray<{ setDocumentMap(map: DocumentMap): void }> };
  /** The root a project's open preview shows. */
  shown(folder: string): string | undefined;
  synctex: ProjectSynctex;
}

export class DocumentMapPublisher implements vscode.Disposable {
  private readonly projects = new Map<string, ReadyProject>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly requests = new Map<string, number>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly deps: Pick<BuildPreviewsDeps, "host" | "paths" | "projects">, private readonly state: DocumentMapPublisherState) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument((event) => this.changed(event.document.uri)),
      vscode.workspace.onDidSaveTextDocument((document) => this.changed(document.uri)),
    ];
  }

  /** Sends the map of the root the project's preview shows, now. */
  publish(project: ReadyProject): void {
    this.projects.set(project.folder, project);
    this.schedule(project.folder, 0);
  }

  /** Sends the last map again after the delay, e.g. to a reader that just attached. */
  resend(folder: string): void {
    if (this.projects.has(folder)) { this.schedule(folder, 0); }
  }

  /** Forgets a project whose preview closed. */
  forget(folder: string): void {
    this.projects.delete(folder);
    clearTimeout(this.timers.get(folder));
    this.timers.delete(folder);
  }

  dispose(): void {
    for (const timer of this.timers.values()) { clearTimeout(timer); }
    for (const subscription of this.subscriptions) { subscription.dispose(); }
  }

  private changed(uri: vscode.Uri): void {
    if (uri.scheme !== "file") { return; }
    const file = uri.fsPath;
    for (const folder of this.projects.keys()) {
      const relative = this.deps.paths.relative(folder, file);
      if (relative.startsWith("..") || this.deps.paths.isAbsolute(relative)) { continue; }
      if (/\.(tex|typ)$/.test(file) || relative.split(/[\\/]/).join("/") === COMMENTS_PATH) { this.schedule(folder, EDIT_DELAY_MS); }
    }
  }

  private schedule(folder: string, delay: number): void {
    clearTimeout(this.timers.get(folder));
    this.timers.set(folder, setTimeout(() => {
      this.timers.delete(folder);
      void this.send(folder);
    }, delay));
  }

  private async send(folder: string): Promise<void> {
    const project = this.projects.get(folder);
    const root = this.state.shown(folder) ?? project?.main;
    const readers = this.state.readers.of(folder);
    if (!project || !root || readers.length === 0) { return; }
    const request = (this.requests.get(folder) ?? 0) + 1;
    this.requests.set(folder, request);
    const logger = this.deps.host.current()?.logger;
    try {
      const map = await this.build(project, root);
      if (this.requests.get(folder) !== request) { return; }
      for (const reader of this.state.readers.of(folder)) { reader.setDocumentMap(map); }
    } catch (error) {
      await logger?.error(PREVIEW_LOG_MODULE, error, { action: "documentMap", projectFolder: folder, root });
    }
  }

  private async build(project: ReadyProject, root: string): Promise<DocumentMap> {
    const { paths } = this.deps;
    const { fs } = this.deps.projects;
    const reader = createProjectSourceReader(vscode.Uri.file(project.folder), () => this.deps.host.current()?.logger);
    const lookup = project.settings.format === "latex" ? await this.state.synctex.load(project, root) : undefined;
    const index = lookup?.status === "found" ? lookup.index : undefined;
    const comments = await fs.readText(paths.join(project.folder, COMMENTS_PATH)).then(parseCommentsQmd, () => undefined);
    return buildDocumentMap({
      format: project.settings.format, root, read: (path) => reader.read(path),
      ...(comments ? { threads: deriveCommentThreads(comments), suggestions: deriveSuggestions(comments) } : {}),
      ...(index ? { locate: (file: string, line: number) => findPagePoint(index, paths.join(project.folder, file), line) } : {}),
    });
  }
}
