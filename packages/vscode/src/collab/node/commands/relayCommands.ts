// Offers the owner's relay to a shared project's relay list and withdraws it, for the project of the active editor or one the user picks.
import * as vscode from "vscode";

import {
  offerOwnRelay,
  removeOwnRelayOffer,
  type ShareConnection,
  type ProjectEntry,
} from "@labshelf/core";
import { CONNECT_RELAY_COMMAND } from "../../../relay/node/index.js";
import { formatProjectName, reportFailure, showRefusedOffer, type CollabHost } from "../collabHost.js";
import * as path from "node:path";
import { findOwningProject, type WritingProjects } from "../../../writing/index.js";

type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;
/** A project folder path (from a script or another command) or a project entry (from a view). */
type ProjectSubmission = string | ProjectEntry | undefined;

async function pickProject(
  projects: Pick<WritingProjects, "list" | "paths">, target: ProjectSubmission, filter: (project: ReadyProject) => boolean, placeHolder: string,
): Promise<ReadyProject | undefined> {
  const ready = projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready" && filter(entry));
  if (typeof target === "string") { return ready.find((entry) => entry.folder === path.resolve(target)); }
  if (target) { return ready.find((entry) => entry.folder === target.folder); }
  const file = vscode.window.activeTextEditor?.document.uri;
  const active = file?.scheme === "file" ? findOwningProject(projects, file.fsPath) : undefined;
  if (active && filter(active)) { return active; }
  if (ready.length === 0) { return undefined; }
  const picked = await vscode.window.showQuickPick(
    ready.map((project) => ({ label: formatProjectName(project), description: project.folder, project })), { placeHolder },
  );
  return picked?.project;
}

export const OFFER_RELAY_COMMAND = "labshelf.relay.offer";
export const WITHDRAW_RELAY_COMMAND = "labshelf.relay.withdraw";

async function pickShare(host: CollabHost, placeHolder: string): Promise<{ share: ShareConnection; name: string } | undefined> {
  const connected = (shareId: string | undefined) => shareId !== undefined && host.shares.active(shareId) !== undefined;
  const project = await pickProject(host.projects, undefined, (entry) => connected(entry.settings.shared), placeHolder);
  const share = project?.settings.shared ? host.shares.active(project.settings.shared) : undefined;
  if (!project || !share) {
    void vscode.window.showInformationMessage("No shared project is connected in this window.");
    return undefined;
  }
  return { share, name: formatProjectName(project) };
}

/** The relay of the connected Cloudflare account; undefined, with an offer to connect, when there is none. */
async function ownRelayUrl(host: CollabHost): Promise<string | undefined> {
  const account = await host.relay.get();
  if (account) { return account.relayUrl; }
  const connect = "Connect Cloudflare";
  void vscode.window.showInformationMessage("Connect Cloudflare first to have a relay to offer.", connect).then((choice) => {
    if (choice === connect) { void vscode.commands.executeCommand(CONNECT_RELAY_COMMAND); }
  });
  return undefined;
}

export async function offerRelay(host: CollabHost): Promise<void> {
  const relayUrl = await ownRelayUrl(host);
  const picked = relayUrl && (await pickShare(host, "Shared project to offer your relay to"));
  if (!picked) { return; }
  try {
    const offer = await offerOwnRelay(host.ports, picked.share);
    showRefusedOffer(offer);
    if (offer.kind === "offered" || offer.kind === "listed") {
      void vscode.window.showInformationMessage(`Offered your relay at ${relayUrl} to "${picked.name}".`);
    }
  } catch (error) {
    reportFailure(host.logger, `offer your relay to "${picked.name}"`, error, { shareId: picked.share.shareId, relayUrl });
  }
}

export async function leaveRelay(host: CollabHost): Promise<void> {
  const relayUrl = await ownRelayUrl(host);
  const picked = relayUrl && (await pickShare(host, "Shared project to withdraw your relay from"));
  if (!picked) { return; }
  try {
    const removed = await removeOwnRelayOffer(host.ports, picked.share, relayUrl);
    void vscode.window.showInformationMessage(removed ? `Withdrew your relay from "${picked.name}".` : `"${picked.name}" does not list a relay you offered.`);
  } catch (error) {
    reportFailure(host.logger, `withdraw your relay from "${picked.name}"`, error, { shareId: picked.share.shareId, relayUrl });
  }
}
