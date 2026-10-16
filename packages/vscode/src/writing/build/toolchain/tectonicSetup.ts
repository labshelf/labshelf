// Returns the installed Tectonic, asking before it downloads the pinned release.
import * as vscode from "vscode";

import { TECTONIC_VERSION, tectonicAsset, texLiveGuideUrl, type LatexToolchain } from "@labshelf/core";
import { installedTectonic, installTectonic } from "@labshelf/core/node";
import type { WritingSession } from "../../projectStore.js";

const DOWNLOAD = "Download";
const OPEN_GUIDE = "Open TeX Live guide";

async function reportUnsupported(): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    `Tectonic is not available for ${process.platform} ${process.arch}. Install TeX Live instead.`,
    OPEN_GUIDE,
  );
  if (choice === OPEN_GUIDE) { await vscode.env.openExternal(vscode.Uri.parse(texLiveGuideUrl(process.platform))); }
}

async function download(storageDir: string, session: WritingSession): Promise<string | undefined> {
  const controller = new AbortController();
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading Tectonic ${TECTONIC_VERSION}`, cancellable: true },
      (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return installTectonic(storageDir, { logger: session.logger, signal: controller.signal });
      },
    );
  } catch (error) {
    // A cancelled download is the user's choice, not a failure to report.
    if (controller.signal.aborted) { return undefined; }
    await vscode.window.showErrorMessage(
      `Tectonic could not be installed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

export async function tectonicToolchain(storageDir: string, session: WritingSession): Promise<LatexToolchain | undefined> {
  const installed = await installedTectonic(storageDir);
  if (installed) { return { engine: "tectonic", executable: installed }; }
  const asset = tectonicAsset(process.platform, process.arch);
  if (!asset) {
    await reportUnsupported();
    return undefined;
  }
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
  if (choice !== DOWNLOAD) { return undefined; }
  const executable = await download(storageDir, session);
  return executable ? { engine: "tectonic", executable } : undefined;
}
