// Routes the Details view's folder requests to the paper list and re-serves its library when the library root changes.
import type * as vscode from "vscode";
import { libraryPaths, ListWebviewPanel, type ListPanelDeps } from "../libraryUi/index.js";
import { rootNode } from "../libraryUi/index.js";
import type { DetailsView } from "../libraryUi/details/index.js";
import type { ActiveServices } from "../command/index.js";
import type { HostAdapters } from "./hostAdapters.js";
import type { ILogger } from "@labshelf/core";

export interface DetailsWiring {
  context: vscode.ExtensionContext;
  details: DetailsView;
  currentServices: () => ActiveServices | null;
  onDidChangeRoot: vscode.Event<unknown>;
  adapters: Pick<HostAdapters, "paths">;
  papersRootUri: () => vscode.Uri | null;
  logger: ILogger;
  /** Builds the list panel dependencies for the open library. */
  listPanelDeps: (services: ActiveServices) => ListPanelDeps;
}

export function wireDetailsSources({ context, details, currentServices, onDidChangeRoot, adapters, papersRootUri, listPanelDeps, logger }: DetailsWiring): void {
  context.subscriptions.push(
    details.onDidRequestFolder((ui) => {
      const services = currentServices();
      const root = papersRootUri()?.fsPath;
      if (!services || !root) {
        void logger.log("WARN", "details.folder", "Folder request dropped: no library is open", { folder: ui });
        return;
      }
      const dir = libraryPaths(root, adapters.paths).fromUi(ui);
      const node = dir === root ? rootNode(dir) : { label: adapters.paths.basename(dir), dirPath: dir };
      ListWebviewPanel.createOrShow(listPanelDeps(services), node);
    }),
    onDidChangeRoot(() => { void details.rebindLibrary(); }),
  );
}
