// Declares what the collaboration commands and views share on the desktop, and how they report a failure.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import type { WritingProjects } from "../../writing/index.js";
import type { SharedEditors } from "./editors/index.js";
import type { ActiveShares, ShareConnection, ShareKeys, ShareStart } from "./session/index.js";

export const LOG_MODULE = "collab";

export interface CollabHost {
  /** The open library's folder, or undefined when none is open. */
  libraryRoot(): string | undefined;
  /** Offers the library setup when none is open; resolves to the library folder or undefined. */
  requireLibrary(): Promise<string | undefined>;
  /** Logs to the open library's logger, whichever library that is at the time. */
  logger: ILogger;
  projects: WritingProjects;
  shares: ActiveShares;
  keys: ShareKeys;
  editors: SharedEditors;
  /** Connects the share in the open library and adds it to `shares`. */
  connect(secret: { shareId: string; shareKey: Uint8Array }, start: ShareStart): Promise<ShareConnection>;
}

/** The name a project goes by in messages. */
export const projectName = (project: { settings: { id: string; title?: string | undefined } }): string => project.settings.title ?? project.settings.id;

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Logs the failure with its context and shows it without waiting, so a command never blocks on the toast. */
export function reportFailure(logger: ILogger, action: string, error: unknown, context: Record<string, unknown> = {}): void {
  void logger.error(LOG_MODULE, error, { action, ...context });
  void vscode.window.showErrorMessage(`LabShelf could not ${action}: ${errorText(error)}`);
}
