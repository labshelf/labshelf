// Asks for an invite link and joins its shared project through the core join workflow, or reconnects one whose key this device lost.
import * as vscode from "vscode";

import { joinSharedProject, parseInvite, type JoinOutcome } from "@labshelf/core";
import { OPEN_PROJECT_COMMAND } from "../../../writing/session/index.js";
import { projectName, reportFailure, type CollabHost } from "../collabHost.js";

export const JOIN_COMMAND = "labshelf.collab.join";
const INSTALL_PAPERS_COMMAND = "labshelf.installProjectPapers";

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

/** Shows progress, since a join waits for a collaborator to answer; cancelling it aborts the join. */
function join(host: CollabHost, text: string): Thenable<JoinOutcome> {
  const options = { location: vscode.ProgressLocation.Notification, title: "Joining the shared project: waiting for a collaborator to answer", cancellable: true };
  return vscode.window.withProgress(options, (_progress, token) => {
    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());
    return joinSharedProject(host.ports, text, abort.signal);
  });
}

/** Resolves to the joined project's folder, or undefined when nothing was joined. */
export async function joinProject(host: CollabHost, inviteText: string | undefined): Promise<string | undefined> {
  if (!(await host.requireLibrary())) { return undefined; }
  const text = typeof inviteText === "string" ? inviteText : await askInvite();
  if (!text?.trim()) { return undefined; }
  try {
    const outcome = await join(host, text);
    if (outcome.kind === "refused") {
      void vscode.window.showErrorMessage(outcome.problem);
      return undefined;
    }
    if (outcome.kind === "active") { void vscode.window.showInformationMessage("This shared project is already connected on this device."); }
    if (outcome.kind === "joined") { offerNextSteps(host, outcome.folder); }
    return outcome.folder;
  } catch (error) {
    reportFailure(host.logger, "join the shared project", error);
    return undefined;
  }
}
