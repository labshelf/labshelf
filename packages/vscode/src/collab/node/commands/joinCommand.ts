// Joins a shared project from an invite link into the library, or reconnects a shared project whose key this device lost.
import * as vscode from "vscode";

import { assertInviteHasRelay, formatInvite, InviteWithoutRelayError, parseInvite, type Invite, type InviteError } from "@labshelf/core";
import { OPEN_PROJECT_COMMAND } from "../../../writing/session/index.js";
import { LOG_MODULE, projectName, reportFailure, type CollabHost } from "../collabHost.js";
import type { ShareConnection } from "../session/index.js";

export const JOIN_COMMAND = "labshelf.collab.join";
const INSTALL_PAPERS_COMMAND = "labshelf.installProjectPapers";

const INVITE_PROBLEMS: Record<InviteError, string> = {
  notAnInvite: "This is not a LabShelf invite link.",
  unsupportedVersion: "This invite comes from a newer LabShelf. Update LabShelf and try again.",
  badShareId: "This invite link is damaged. Ask for a new one.",
  badKey: "This invite link is damaged. Ask for a new one.",
  badRelayList: "This invite link is damaged. Ask for a new one.",
  shareIdMismatch: "This invite link is damaged. Ask for a new one.",
};

async function askInvite(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Join Shared Project",
    prompt: "Paste the invite link a collaborator sent you",
    placeHolder: "labshelf://join#…",
    ignoreFocusOut: true,
    validateInput: async (value) => (value.trim() === "" ? undefined : (await parseInvite(value)).ok ? undefined : "This is not a LabShelf invite link"),
  });
}

/** Offers what usually comes next, without waiting for the answer. */
function offerNextSteps(host: CollabHost, folder: string): void {
  const project = host.projects.list().find((entry) => entry.kind === "ready" && entry.folder === folder);
  if (project?.kind !== "ready") { return; }
  const open = "Open Project";
  const install = "Import Papers";
  const papers = project.settings.papers?.length ?? 0;
  const actions = papers > 0 ? [open, install] : [open];
  const detail = papers > 0 ? ` It lists ${papers} paper${papers === 1 ? "" : "s"}; import the ones your library lacks?` : "";
  void vscode.window.showInformationMessage(`Joined "${projectName(project)}".${detail}`, ...actions).then((choice) => {
    if (choice === open) { void vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, project); }
    if (choice === install) { void vscode.commands.executeCommand(INSTALL_PAPERS_COMMAND, project); }
  });
}

function joinNew(host: CollabHost, invite: Invite): Thenable<ShareConnection> {
  const options = { location: vscode.ProgressLocation.Notification, title: "Joining the shared project: waiting for a collaborator to answer", cancellable: true };
  return vscode.window.withProgress(options, (_progress, token) => {
    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());
    return host.connect(invite, { mode: "join", signal: abort.signal });
  });
}

/** Resolves to the joined project's folder, or undefined when nothing was joined. */
export async function joinProject(host: CollabHost, inviteText: string | undefined): Promise<string | undefined> {
  if (!(await host.requireLibrary())) { return undefined; }
  const text = typeof inviteText === "string" ? inviteText : await askInvite();
  if (!text?.trim()) { return undefined; }
  const parsed = await parseInvite(text);
  if (!parsed.ok) {
    void host.logger.log("WARN", LOG_MODULE, "Refused an invite that does not parse", { error: parsed.error });
    void vscode.window.showErrorMessage(INVITE_PROBLEMS[parsed.error]);
    return undefined;
  }
  const { invite } = parsed;
  const active = host.shares.get(invite.shareId);
  if (active) {
    void vscode.window.showInformationMessage("This shared project is already connected on this device.");
    return active.folder;
  }
  try {
    assertInviteHasRelay(invite);
    const link = await formatInvite({ shareKey: invite.shareKey, relays: invite.relays });
    const known = host.projects.list().find((entry) => entry.kind === "ready" && entry.settings.shared === invite.shareId);
    const folder = await host.shares.hold(invite.shareId, async () => {
      const share = known ? await host.connect(invite, { mode: "resume", folder: known.folder }) : await joinNew(host, invite);
      await host.keys.remember(link, invite.shareId);
      await host.projects.reload();
      return share.folder;
    });
    void host.logger.log("INFO", LOG_MODULE, known ? "Reconnected a shared project from its invite" : "Joined a shared project", { folder, shareId: invite.shareId });
    if (!known) { offerNextSteps(host, folder); }
    return folder;
  } catch (error) {
    if (error instanceof InviteWithoutRelayError) {
      void host.logger.log("WARN", LOG_MODULE, "Refused an invite that lists no relay", { shareId: invite.shareId });
      void vscode.window.showErrorMessage(error.message);
      return undefined;
    }
    reportFailure(host.logger, "join the shared project", error, { shareId: invite.shareId });
    return undefined;
  }
}
