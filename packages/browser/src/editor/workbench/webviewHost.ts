// Points the workbench's webviews at the host page the build rewrites for the extension CSP, in place of VS Code's own.
import { registerAssets } from "@codingame/monaco-vscode-api/assets";
import { WEBVIEW_HOST_FILES } from "../webview";

const pageUrl = (file: string): string => new URL(file, location.href).toString();

/** Call after the workbench service override is imported: its own webview registrations must be the ones replaced. */
export function installWebviewHost(): void {
  registerAssets({
    "vs/workbench/contrib/webview/browser/pre/index.html": pageUrl(WEBVIEW_HOST_FILES.index),
    "vs/workbench/contrib/webview/browser/pre/fake.html": pageUrl(WEBVIEW_HOST_FILES.fake),
  });
}
