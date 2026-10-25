// Declares what the collaboration commands and views share on the desktop, and how they report a failure.
import * as vscode from "vscode";

import type { WritingProjects } from "../../writing/index.js";
import type { SharedEditors } from "./editors/index.js";
import type { ILogger, OwnRelayOffer, RelayAccountStore, ShareFlowPorts } from "@labshelf/core";
import type { ActiveShares } from "./session/index.js";

const LOG_MODULE = "collab";

export interface CollabHost {
  /** The open library's folder, or undefined when none is open. */
  libraryRoot(): string | undefined;
  /** Offers the library setup when none is open; resolves to the library folder or undefined. */
  requireLibrary(): Promise<string | undefined>;
  /** Logs to the open library's logger, whichever library that is at the time. */
  logger: ILogger;
  projects: WritingProjects;
  shares: ActiveShares;
  editors: SharedEditors;
  /** The owner's Cloudflare relay, when this device connected one. */
  relay: RelayAccountStore;
  /** What the core share, join, resume and leave workflows run on in this window. */
  ports: ShareFlowPorts;
}

/** The name a project goes by in messages. */
export const formatProjectName = (project: { settings: { id: string; title?: string | undefined } }): string => project.settings.title ?? project.settings.id;

export const formatErrorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Logs the failure with its context and shows it without waiting, so a command never blocks on the toast. */
export function reportFailure(logger: ILogger, action: string, error: unknown, context: Record<string, unknown> = {}): void {
  void logger.error(LOG_MODULE, error, { action, ...context });
  void vscode.window.showErrorMessage(`LabShelf could not ${action}: ${formatErrorText(error)}`);
}

/** Shows a refused offer of the owner's relay; the workflow logged it already. */
export function showRefusedOffer(offer: OwnRelayOffer): void {
  if (offer.kind !== "refused") { return; }
  void vscode.window.showWarningMessage(`Your relay did not take the project, so it syncs without it: ${formatErrorText(offer.error)}`);
}
