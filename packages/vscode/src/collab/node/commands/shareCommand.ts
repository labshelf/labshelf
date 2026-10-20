// Shares a project, or reconnects one shared before, through the core share workflow and copies its invite for the collaborators.
import * as vscode from "vscode";

import { shareProject as runShare } from "@labshelf/core";
import { projectName, reportFailure, showRefusedOffer, type CollabHost } from "../collabHost.js";
import { copyInvite } from "./copyInvite.js";
import { pickProject, type ProjectTarget } from "./projectTarget.js";

export const SHARE_COMMAND = "labshelf.collab.share";

/** Resolves to the invite link, or undefined when nothing was shared. */
export async function shareProject(host: CollabHost, target: ProjectTarget): Promise<string | undefined> {
  if (!(await host.requireLibrary())) { return undefined; }
  const project = await pickProject(host.projects, target, (entry) => !entry.settings.trashed, "Project to share");
  if (!project) {
    void vscode.window.showInformationMessage(typeof target === "string" ? `No LabShelf project is in ${target}.` : "Open a project to share it.");
    return undefined;
  }
  const name = projectName(project);
  const { folder, settings: { shared } } = project;
  try {
    const outcome = await runShare(host.ports, { folder, shared, signal: new AbortController().signal });
    if (outcome.kind === "noKey") {
      void vscode.window.showWarningMessage(`"${name}" is shared, but its invite is not on this device. Paste it with Join Shared Project to reconnect.`);
      return undefined;
    }
    if (outcome.kind === "noRelay") {
      void vscode.window.showInformationMessage("Sharing needs a Cloudflare relay: every edit travels through it, end-to-end encrypted. Connect Cloudflare to share.");
      return undefined;
    }
    showRefusedOffer(outcome.offer);
    await copyInvite(outcome.invite, name);
    return outcome.invite;
  } catch (error) {
    reportFailure(host.logger, `share "${name}"`, error, { folder, shareId: shared });
    return undefined;
  }
}
