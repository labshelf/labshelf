// Asks the VS Code user about the LaTeX toolchain with quick picks, modals and a cancellable progress notification.
import * as vscode from "vscode";

import { engineLabel, TECTONIC_VERSION, texLiveGuideUrl, type LatexEngine, type TectonicAsset, type ToolchainPrompt } from "@labshelf/core";

const OPEN_GUIDE = "Open install guide";
const USE_TECTONIC = "Use Tectonic";
const DOWNLOAD = "Download";

type EnginePick = vscode.QuickPickItem & { engine: LatexEngine };

export const vscodeToolchainPrompt: ToolchainPrompt = {
  async pickEngine({ texLiveInstalled, tectonic: asset }) {
    const tectonic: EnginePick = {
      label: engineLabel("tectonic"),
      description: "recommended",
      detail: asset
        ? `Downloads about ${asset.sizeMb} MB once and fetches packages as documents need them.`
        : "Not available on this system.",
      engine: "tectonic",
    };
    const texLive: EnginePick = {
      label: "TeX Live (latexmk)",
      detail: texLiveInstalled ? "Uses the TeX Live installed on this computer." : "TeX Live is not installed.",
      engine: "pdflatex",
    };
    const picked = await vscode.window.showQuickPick<EnginePick>(texLiveInstalled ? [texLive, tectonic] : [tectonic, texLive], {
      placeHolder: "Choose how LabShelf builds LaTeX projects",
    });
    return picked?.engine;
  },

  async confirmTectonicDownload(asset: TectonicAsset) {
    const choice = await vscode.window.showInformationMessage(
      `Download Tectonic ${TECTONIC_VERSION} (about ${asset.sizeMb} MB)?`,
      {
        modal: true,
        detail: "LabShelf needs Tectonic to build this project. It is downloaded once from the Tectonic releases on GitHub "
          + "(github.com/tectonic-typesetting/tectonic) and stored in LabShelf's storage. Tectonic then fetches LaTeX "
          + "packages as documents need them.",
      },
      DOWNLOAD,
    );
    return choice === DOWNLOAD;
  },

  downloading(run) {
    const controller = new AbortController();
    return Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading Tectonic ${TECTONIC_VERSION}`, cancellable: true },
      (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return run(controller.signal);
      },
    ));
  },

  async offerTectonic(engine) {
    const choice = await vscode.window.showErrorMessage(
      `${engineLabel(engine)} needs TeX Live, which is not installed. Tectonic runs only XeLaTeX.`,
      OPEN_GUIDE,
      USE_TECTONIC,
    );
    if (choice === OPEN_GUIDE) {
      await vscode.env.openExternal(vscode.Uri.parse(texLiveGuideUrl(process.platform)));
    }
    return choice === USE_TECTONIC;
  },
};
