// Shows the conflict notification after a scan and walks the user through resolving the copies.
import * as vscode from "vscode";
import { conflictOwnerLabel, contentConflictMessage, errorMessage, type ConflictCopy, type ConflictResolution, type ILogger, type PathOps } from "@labshelf/core";
import type { ActiveServices } from "../../command/index.js";
import { conflictChoices, toolName } from "./conflictChoices.js";
import { ConflictNotifier, conflictMessage } from "./conflictNotifier.js";
import { walkConflicts } from "./conflictWalk.js";

const MODULE = "library/conflicts";

export interface ConflictHandlingDeps {
  getServices: () => ActiveServices | null;
  getRoot: () => string | null;
  scanConflicts: (root: string, logger: ILogger) => Promise<ConflictCopy[]>;
  resolveCopy: (copy: ConflictCopy, resolution: ConflictResolution, logger: ILogger) => Promise<void>;
  paths: Pick<PathOps, "basename">;
}

export class ConflictHandling {
  private readonly notifier = new ConflictNotifier();
  private resolving = false;

  constructor(private readonly deps: ConflictHandlingDeps) {}

  /** Receives every scan's copies; the file changes a resolve makes would otherwise notify mid-walk. */
  onConflicts(copies: ConflictCopy[]): void {
    if (this.resolving) { return; }
    if (!this.notifier.shouldNotify(copies.length)) { return; }
    void vscode.window.showInformationMessage(conflictMessage(copies.length), "Resolve").then((choice) => {
      if (choice === "Resolve") { void this.resolve(); }
    });
  }

  async resolve(): Promise<void> {
    const services = this.deps.getServices();
    const root = this.deps.getRoot();
    if (!services || !root || this.resolving) { return; }
    this.resolving = true;
    let remaining = 0;
    try {
      const copies = await this.deps.scanConflicts(root, services.logger);
      if (copies.length === 0) { void vscode.window.showInformationMessage("No conflicting copies"); return; }
      remaining = await walkConflicts(copies, {
        ask: (copy, index, total) => this.ask(copy, index, total, services),
        mergeMyself: async (copy) => { await vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(copy.original), vscode.Uri.file(copy.copy)); },
        apply: (copy, resolution) => this.deps.resolveCopy(copy, resolution, services.logger),
        onFailure: (copy, error) => {
          void services.logger.error(MODULE, error, { copy: copy.copy });
          void vscode.window.showErrorMessage(`Could not resolve ${this.deps.paths.basename(copy.copy)}: ${errorMessage(error)}`);
        },
      });
      await services.reindexLibrary();
    } catch (error) {
      await services.logger.error(MODULE, error, { action: "resolve" });
      void vscode.window.showErrorMessage(`Could not resolve conflicts: ${errorMessage(error)}`);
    } finally {
      this.notifier.markSeen(remaining);
      this.resolving = false;
    }
  }

  private async ask(copy: ConflictCopy, index: number, total: number, services: ActiveServices): Promise<ConflictResolution | "mergeMyself" | undefined> {
    const title = conflictOwnerLabel(copy.owner, copy.owner.kind === "paper" ? services.library.paper(copy.owner.id)?.record.title : undefined);
    const picked = await vscode.window.showQuickPick(
      conflictChoices(copy).map((choice) => ({ label: choice.label, resolution: choice.resolution })),
      {
        title: `${title} (${index + 1} of ${total})`,
        placeHolder: copy.match && copy.match !== "name" ? contentConflictMessage(copy) : `${this.deps.paths.basename(copy.original)}: a conflicting copy from ${toolName(copy.tool)}`,
      },
    );
    return picked?.resolution;
  }
}
