// Registers catalog and Space editor commands with Research chat context.
import * as vscode from "vscode";
import type { SpacesService } from "../host/index.js";
import { SpacesPanelRegistry } from "./panelRegistry.js";

export interface SpacesPanelContext extends vscode.Disposable {
  context(): string | null;
  onDidChangeContext: vscode.Event<string | null>;
}

export function registerSpacesPanels(context: vscode.ExtensionContext, spaces: SpacesService): SpacesPanelContext {
  const registry = new SpacesPanelRegistry(context.extensionUri, spaces);
  context.subscriptions.push(registry,
    vscode.commands.registerCommand("labshelf.spaces.all", () => registry.open()),
    vscode.commands.registerCommand("labshelf.spaces.open", (id: unknown, tab?: unknown) => { if (typeof id === "string") registry.open(id, tab); }),
  );
  return registry;
}
