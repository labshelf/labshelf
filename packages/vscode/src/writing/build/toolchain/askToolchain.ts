// Asks the VS Code user whether to install LaTeX and shows install progress in a notification.
import * as vscode from "vscode";

import type { TexSetupAsk } from "@labshelf/core";

const LIGHT = "Install Light";
const FULL = "Install Full";

export function vscodeToolchainPrompt(): TexSetupAsk {
  return {
    async chooseInstall() {
      const choice = await vscode.window.showInformationMessage(
        "LaTeX is not installed on this computer. LabShelf can install it for every LabShelf app.",
        {
          modal: true,
          detail: "Light installs TinyTeX (about 100 MB) and adds packages when a project needs them. "
            + "Full installs TeX Live (about 5 GB) and works offline.",
        },
        LIGHT,
        FULL,
      );
      if (choice === LIGHT) { return "tinytex"; }
      return choice === FULL ? "texlive" : undefined;
    },

    progress(title, run) {
      return Promise.resolve(vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        (progress) => run((message) => progress.report({ message })),
      ));
    },
  };
}
