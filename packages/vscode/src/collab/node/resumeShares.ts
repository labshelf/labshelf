// Keeps the connected shares in step with the project list: reconnects shared projects whose key is stored, drops the rest.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { LOG_MODULE, projectName, reportFailure, type CollabHost } from "./collabHost.js";
import { JOIN_COMMAND } from "./commands/index.js";

type SharedProject = Extract<ProjectEntry, { kind: "ready" }> & { settings: { shared: string } };

const isShared = (entry: ProjectEntry): entry is SharedProject =>
  entry.kind === "ready" && typeof entry.settings.shared === "string" && !entry.settings.trashed;

/** Each project without a stored key is pointed at its invite once per window; `asked` also holds the shares that failed to reconnect. */
function askForInvite(host: CollabHost, project: SharedProject, asked: Set<string>): void {
  if (asked.has(project.settings.shared)) { return; }
  asked.add(project.settings.shared);
  void host.logger.log("WARN", LOG_MODULE, "A shared project has no stored key on this device; asking for its invite", { folder: project.folder, shareId: project.settings.shared });
  const join = "Join";
  void vscode.window.showInformationMessage(`Shared project "${projectName(project)}": paste the invite to reconnect.`, join).then((choice) => {
    if (choice === join) { void vscode.commands.executeCommand(JOIN_COMMAND); }
  });
}

async function resume(host: CollabHost, project: SharedProject, asked: Set<string>): Promise<void> {
  const shareId = project.settings.shared;
  await host.shares.hold(shareId, async () => {
    const stored = await host.keys.invite(shareId);
    if (!stored) { askForInvite(host, project, asked); return; }
    await host.connect(stored.invite, { mode: "resume", folder: project.folder });
    void host.logger.log("INFO", LOG_MODULE, "Resumed a shared project", { folder: project.folder, shareId });
  });
}

async function sync(host: CollabHost, asked: Set<string>): Promise<void> {
  const shared = host.projects.list().filter(isShared);
  for (const share of host.shares.list()) {
    if (host.shares.isBusy(share.shareId)) { continue; }
    if (!shared.some((project) => project.folder === share.folder && project.settings.shared === share.shareId)) {
      void host.logger.log("INFO", LOG_MODULE, "Disconnected a share whose project left the list", { folder: share.folder, shareId: share.shareId });
      await host.shares.remove(share.shareId);
    }
  }
  for (const project of shared) {
    const shareId = project.settings.shared;
    if (host.shares.get(shareId) || host.shares.isBusy(shareId) || asked.has(shareId)) { continue; }
    await resume(host, project, asked).catch((error: unknown) => {
      // One report per window: the next reload would fail the same way.
      asked.add(shareId);
      reportFailure(host.logger, `reconnect the shared project "${projectName(project)}"`, error, { folder: project.folder, shareId });
    });
  }
}

/** Runs on every reload of the project list, which also follows a change of library. */
export function resumeShares(host: CollabHost): vscode.Disposable {
  const asked = new Set<string>();
  let running = Promise.resolve();
  const run = () => { running = running.then(() => sync(host, asked)); };
  const subscription = host.projects.onDidChange(run);
  run();
  return subscription;
}
