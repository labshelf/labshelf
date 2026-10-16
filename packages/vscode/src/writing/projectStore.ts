// Holds the writing projects of the open library and tells views when the list is reloaded.
import * as vscode from "vscode";

import type { ILogger, PathOps, ProjectDataPort, ProjectEntry } from "@labshelf/core";

/** The open library as writing code needs it: a folder path and the logger of that library. */
export interface WritingSession {
  root: string;
  logger: ILogger;
}

/** Where the writing code gets its session; `require` offers the library setup when none is configured. */
export interface WritingHost {
  current: () => WritingSession | undefined;
  require: () => Promise<WritingSession | undefined>;
}

export class WritingProjects implements vscode.Disposable {
  private entries: readonly ProjectEntry[] = [];
  private reloadCount = 0;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  /**
   * @param paths The path style of the project folders: the host's, which is not always "/".
   * @param data Reads and writes the project folders and the project registry.
   */
  constructor(private readonly host: Pick<WritingHost, "current">, readonly paths: PathOps, readonly data: ProjectDataPort) {}

  list(): readonly ProjectEntry[] {
    return this.entries;
  }

  async reload(): Promise<void> {
    const session = this.host.current();
    const ticket = ++this.reloadCount;
    let entries: readonly ProjectEntry[] = [];
    if (session) {
      try {
        entries = await this.data.listProjects(session.root);
      } catch (error) {
        await session.logger.error("writing/projects", error, { action: "list" });
      }
    }
    // A slower, older reload must not overwrite a newer result.
    if (ticket !== this.reloadCount) { return; }
    this.entries = entries;
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
