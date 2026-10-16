// Builds a project's reading list from the backlink index, the project's papers: entries and the library, and tells the view when it may have changed.
import * as vscode from "vscode";

import { buildReadingList, papersByCiteKey, type BacklinkIndex, type ILogger, type PaperRecord, type ReadingList } from "@labshelf/core";
import type { ReadyProject } from "../figures/index.js";

/** The open library as the reading list needs it. */
export interface ReadingListSession {
  listPapers(): Promise<PaperRecord[]>;
  /** True when the paper's reader sidecar holds a reading position. */
  isOpened(paperId: string): Promise<boolean>;
  logger: ILogger;
}

interface ReadingListSources {
  backlinks: { index(): BacklinkIndex; onDidChange: vscode.Event<void> };
  session: () => ReadingListSession | undefined;
  /** Fires when the library's papers change. */
  onPapersChange: (listener: () => void) => vscode.Disposable;
}

export class ProjectReadingLists implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly sources: ReadingListSources) {
    this.subscriptions = [sources.backlinks.onDidChange(() => this.refresh()), sources.onPapersChange(() => this.refresh())];
  }

  /** The project's reading list; empty when no library is open or its papers cannot be read, after logging why. */
  async of(project: ReadyProject): Promise<ReadingList> {
    const session = this.sources.session();
    if (!session) { return { entries: [], neverOpened: 0 }; }
    try {
      return await buildReadingList({
        project: project.settings.id,
        backlinks: this.sources.backlinks.index(),
        listed: project.settings.papers ?? [],
        papersByKey: papersByCiteKey(await session.listPapers()),
        isOpened: (paperId) => session.isOpened(paperId),
      });
    } catch (error) {
      await session.logger.error("writing/readingList", error, { action: "build", project: project.settings.id });
      return { entries: [], neverOpened: 0 };
    }
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) { subscription.dispose(); }
    this.changeEmitter.dispose();
  }
}
