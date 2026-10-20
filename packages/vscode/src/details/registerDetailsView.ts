// Registers the Details webview view in the secondary sidebar.
import * as vscode from "vscode";
import { DETAILS_VIEW, DetailsView, type DetailsViewDeps } from "./detailsView.js";

export function registerDetailsView(context: vscode.ExtensionContext, deps: DetailsViewDeps): DetailsView {
  const view = new DetailsView(deps);
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(DETAILS_VIEW, view, { webviewOptions: { retainContextWhenHidden: true } }),
  );
  return view;
}
