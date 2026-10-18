// Shares a project: makes a new share key, connects the project, keeps the invite and copies it for the collaborators.
import * as vscode from "vscode";

import { deriveShareId, formatInvite, generateShareKey } from "@labshelf/core";
import { LOG_MODULE, projectName, reportFailure, type CollabHost } from "../collabHost.js";
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
  const existing = project.settings.shared;
  try {
    if (existing) {
      const stored = await host.keys.invite(existing);
      if (!stored) {
        void vscode.window.showWarningMessage(`"${name}" is shared, but its invite is not on this device. Paste it with Join Shared Project to reconnect.`);
        return undefined;
      }
      if (!host.shares.get(existing)) { await host.shares.hold(existing, () => host.connect(stored.invite, { mode: "resume", folder: project.folder })); }
      await copyInvite(stored.link, name);
      return stored.link;
    }
    const shareKey = generateShareKey();
    const shareId = await deriveShareId(shareKey);
    const link = await formatInvite({ shareKey, relays: [] });
    await host.shares.hold(shareId, async () => {
      await host.keys.remember(link, shareId);
      try {
        await host.connect({ shareId, shareKey }, { mode: "share", folder: project.folder });
      } catch (error) {
        await host.keys.forget(shareId);
        throw error;
      }
      await host.projects.reload();
    });
    void host.logger.log("INFO", LOG_MODULE, "Shared a project from VS Code", { folder: project.folder, shareId });
    await copyInvite(link, name);
    return link;
  } catch (error) {
    reportFailure(host.logger, `share "${name}"`, error, { folder: project.folder, shareId: existing });
    return undefined;
  }
}
