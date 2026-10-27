// Keeps the open project's checklist signals current: re-read on open and, debounced, on save, plus its page count.
import * as vscode from "vscode";

import { isInside, type ChecklistSignals, type ILogger, type PageOverflow, type PathOps } from "@labshelf/core";
import type { ReadyProject } from "../figures/index.js";
import type { BodyPagesCount } from "../preview/index.js";
import { disposeAll } from "../../disposables/index.js";

const SAVE_DEBOUNCE_MS = 400;

export interface ProjectSignals {
  project: ReadyProject;
  signals: ChecklistSignals;
  pageOverflow: PageOverflow | undefined;
  /** The body's page count against its limit; set whenever a limit and a count exist. */
  pageCount: PageOverflow | undefined;
}

export interface OpenProjectSignalsDeps {
  session: { readonly project: ReadyProject | undefined; readonly onDidChange: vscode.Event<ReadyProject | undefined> };
  readSignals: (project: ReadyProject, logger: ILogger) => Promise<ChecklistSignals>;
  onDidSaveTextDocument: vscode.Event<vscode.TextDocument>;
  onDidCountBodyPages: vscode.Event<BodyPagesCount>;
  logger: ILogger;
  paths: PathOps;
}

export class OpenProjectSignals implements vscode.Disposable {
  private state: ProjectSignals | undefined;
  /** The main root's last body-page count; kept apart from `state` so a count that beats the first read survives. */
  private bodyPages: { folder: string; pages: number } | undefined;
  /** Bumped on every open, close and read so a read that finishes late is dropped. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly deps: OpenProjectSignalsDeps) {
    this.subscriptions = [
      deps.session.onDidChange((project) => this.open(project)),
      deps.onDidSaveTextDocument((document) => this.onSaved(document)),
      deps.onDidCountBodyPages((count) => this.onBodyPages(count)),
    ];
    this.open(deps.session.project);
  }

  get current(): ProjectSignals | undefined {
    return this.state;
  }

  /** Re-reads the signals now; nothing happens when no project is open. */
  async refresh(): Promise<void> {
    this.clearTimer();
    const project = this.deps.session.project;
    if (!project) { return; }
    await this.read(project, ++this.generation);
  }

  dispose(): void {
    this.generation++;
    this.clearTimer();
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }

  private open(project: ReadyProject | undefined): void {
    this.generation++;
    this.clearTimer();
    if (this.state) {
      this.state = undefined;
      this.changeEmitter.fire();
    }
    if (project) { void this.read(project, this.generation); }
  }

  private async read(project: ReadyProject, generation: number): Promise<void> {
    let signals: ChecklistSignals;
    try {
      signals = await this.deps.readSignals(project, this.deps.logger);
    } catch (error) {
      await this.deps.logger.error("writing/checklist", error, { action: "read-signals", folder: project.folder });
      return;
    }
    if (generation !== this.generation) { return; }
    this.state = { project, signals, ...this.pages(project) };
    this.changeEmitter.fire();
  }

  private pages(project: ReadyProject): Pick<ProjectSignals, "pageOverflow" | "pageCount"> {
    const limit = project.settings.check?.pages;
    const pages = this.bodyPages?.folder === project.folder ? this.bodyPages.pages : undefined;
    if (limit === undefined || pages === undefined) { return { pageOverflow: undefined, pageCount: undefined }; }
    return { pageOverflow: pages > limit ? { pages, limit } : undefined, pageCount: { pages, limit } };
  }

  private onSaved(document: vscode.TextDocument): void {
    const project = this.deps.session.project;
    if (!project || !isInside(this.deps.paths, project.folder, document.uri.fsPath)) { return; }
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.read(project, ++this.generation);
    }, SAVE_DEBOUNCE_MS);
  }

  private onBodyPages(count: BodyPagesCount): void {
    const project = this.deps.session.project;
    if (!project || count.folder !== project.folder || count.root !== project.main) { return; }
    this.bodyPages = { folder: project.folder, pages: count.contentPages };
    if (!this.state) { return; }
    this.state = { ...this.state, ...this.pages(project) };
    this.changeEmitter.fire();
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
  }
}
