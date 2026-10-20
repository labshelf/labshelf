// Runs the core resume workflow on every reload of the project list and shows what it reports.
import * as vscode from "vscode";

import { createShareResumer } from "@labshelf/core";
import { errorText, projectName, type CollabHost } from "./collabHost.js";
import { JOIN_COMMAND } from "./commands/index.js";

/** A reload also follows a change of library. */
export function resumeShares(host: CollabHost): vscode.Disposable {
  const resumer = createShareResumer(host.ports, {
    missingKey: (project) => {
      const join = "Join";
      void vscode.window.showInformationMessage(`Shared project "${projectName(project)}": paste the invite to reconnect.`, join).then((choice) => {
        if (choice === join) { void vscode.commands.executeCommand(JOIN_COMMAND); }
      });
    },
    failed: (project, error) => {
      void vscode.window.showErrorMessage(`LabShelf could not reconnect the shared project "${projectName(project)}": ${errorText(error)}`);
    },
  });
  const subscription = host.projects.onDidChange(() => void resumer.sync());
  void resumer.sync();
  return subscription;
}
