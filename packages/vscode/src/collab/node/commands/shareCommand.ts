// Shares a project: makes a new share key, connects the project, offers the owner's relay, keeps the invite and copies it for the collaborators.
import * as vscode from "vscode";

import { deriveShareId, formatInvite, generateShareKey, type Invite, type ShareConnection } from "@labshelf/core";
import { CONNECT_RELAY_COMMAND } from "../../../relay/index.js";
import { LOG_MODULE, projectName, reportFailure, type CollabHost } from "../collabHost.js";
import { offerOwnRelay, rememberInvite } from "../ownRelay.js";
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
      const resume = () => host.connect(stored.invite, { mode: "resume", folder: project.folder });
      const share = await host.shares.hold(existing, async () => host.shares.get(existing) ?? resume());
      const link = await withOwnRelay(host, share);
      await copyInvite(link, name);
      return link;
    }
    if (!(await ensureRelay(host))) { return undefined; }
    const shareKey = generateShareKey();
    const shareId = await deriveShareId(shareKey);
    const share = await host.shares.hold(shareId, () => connectNew(host, { shareId, shareKey, relays: [] }, project.folder));
    const link = await withOwnRelay(host, share);
    void host.logger.log("INFO", LOG_MODULE, "Shared a project from VS Code", { folder: project.folder, shareId });
    await copyInvite(link, name);
    return link;
  } catch (error) {
    reportFailure(host.logger, `share "${name}"`, error, { folder: project.folder, shareId: existing });
    return undefined;
  }
}

/** True when a Cloudflare relay is connected, after running Connect Cloudflare when none was; a cancelled connect cancels the share. */
async function ensureRelay(host: CollabHost): Promise<boolean> {
  if (await host.relay.get()) { return true; }
  await vscode.commands.executeCommand(CONNECT_RELAY_COMMAND);
  if (await host.relay.get()) { return true; }
  void host.logger.log("INFO", LOG_MODULE, "Sharing cancelled: no Cloudflare relay was connected");
  void vscode.window.showInformationMessage("Sharing needs a Cloudflare relay: every edit travels through it, end-to-end encrypted. Connect Cloudflare to share.");
  return false;
}

/** Keeps the invite before connecting, so the project list reload that follows finds the key. */
async function connectNew(host: CollabHost, invite: Invite, folder: string): Promise<ShareConnection> {
  await host.keys.remember(await formatInvite(invite), invite.shareId);
  try {
    const share = await host.connect(invite, { mode: "share", folder });
    await host.projects.reload();
    return share;
  } catch (error) {
    await host.keys.forget(invite.shareId);
    throw error;
  }
}

/** The invite link to hand out, after the owner's relay joined the share's list when one is connected. */
async function withOwnRelay(host: CollabHost, share: ShareConnection): Promise<string> {
  await offerOwnRelay(host, share);
  return rememberInvite(host, share);
}
