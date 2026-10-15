// Reports whether a built webview bundle file is on disk, through the VS Code file system so it works in any host.
import * as vscode from "vscode";

export async function bundleExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
