// Composes Spaces surfaces with the active Library and writing projects.
import * as vscode from "vscode";
import type { LibraryRootController } from "../activation/index.js";
import type { HostAdapters } from "../activation/index.js";
import type { WritingViewHandles } from "../activation/index.js";
import { projectChecklist } from "./projectTaskProgress.js";
import { SpacesService } from "./host/index.js";
import { registerSpacesPanels } from "./panels/index.js";
import { ResearchChatView } from "./researchChatView.js";

export function registerSpaces(
  context: vscode.ExtensionContext, controller: LibraryRootController, adapters: HostAdapters, writing: WritingViewHandles,
  selectPaper: (id: string) => Promise<void>,
): SpacesService {
  const spaces = new SpacesService({
    controller, paths: adapters.paths, projectLibrary: writing.projectLibrary, logger: writing.logger, selectPaper,
    projectId: hostId => {
      const entry = writing.projects.list().find(project => project.folder === hostId);
      return entry?.kind === "ready" ? entry.settings.id : undefined;
    },
    readChecklist: row => projectChecklist(writing, row),
  });
  const panels = registerSpacesPanels(context, spaces);
  const chat = new ResearchChatView(context.extensionUri, panels, writing.logger);
  context.subscriptions.push(spaces, chat,
    vscode.window.registerWebviewViewProvider("labshelf.researchChat", chat),
    vscode.commands.registerCommand("labshelf.researchChat.toggle", () => chat.toggle()));
  return spaces;
}
