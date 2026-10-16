// Creates the Checklist view of the open project and registers its commands.
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

import type { ILogger, PaperStatus } from "@labshelf/core";
import { readChecklistSignals, updateChecklist } from "@labshelf/core/node";
import type { ArcIcon } from "../../ui/index.js";
import { CHECK_COMMAND } from "../check/index.js";
import type { BuildPreviews } from "../preview/index.js";
import type { ProjectReadingLists } from "../readingList/index.js";
import type { ProjectSession } from "../session/index.js";
import type { ChecklistNode } from "./checklistNodes.js";
import { NEXT_STATUS_COMMAND } from "./checklistTreeItem.js";
import { ChecklistView } from "./checklistView.js";
import { OpenProjectSignals } from "./openProjectSignals.js";

const VIEW_ID = "labshelf.writing.checklist";

export interface ChecklistViewRegistration {
  context: vscode.ExtensionContext;
  session: ProjectSession;
  previews: Pick<BuildPreviews, "onDidCountBodyPages">;
  readingLists: ProjectReadingLists;
  /** Fires when the project backlinks, and so the reading lists, change. */
  onDidChangeBacklinks: vscode.Event<void>;
  /** Writes paper statuses through the open library and returns the ids that failed; with no library open every id failed. */
  setStatus: (paperIds: string[], status: PaperStatus) => Promise<string[]>;
  logger: ILogger;
  arcIcon: ArcIcon;
}

export function registerChecklistView(deps: ChecklistViewRegistration): void {
  const { context, session, logger } = deps;
  const signals = new OpenProjectSignals({
    session, readSignals: readChecklistSignals, onDidSaveTextDocument: vscode.workspace.onDidSaveTextDocument,
    onDidCountBodyPages: deps.previews.onDidCountBodyPages, logger,
  });
  const view = new ChecklistView({
    signals,
    reading: { of: (project) => deps.readingLists.of(project), onDidChange: deps.onDidChangeBacklinks },
    memory: context.workspaceState,
    setStatus: deps.setStatus,
    updateChecklist,
    logger,
    arcIcon: deps.arcIcon,
    newId: randomUUID,
    now: () => new Date(),
  });
  const tree = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: view, showCollapseAll: false, manageCheckboxStateManually: true });
  view.attach(tree);
  const command = vscode.commands.registerCommand;
  context.subscriptions.push(
    signals,
    view,
    tree,
    tree.onDidExpandElement((e) => void view.onDidExpand(e.element)),
    tree.onDidCollapseElement((e) => void view.onDidCollapse(e.element)),
    tree.onDidChangeCheckboxState((e) => { for (const [node, state] of e.items) { void view.setChecked(node, state); } }),
    command("labshelf.writing.checklist.bySection", () => view.toggleGrouping()),
    command("labshelf.writing.checklist.byKind", () => view.toggleGrouping()),
    command("labshelf.writing.checklist.addItem", () => view.addItem()),
    command("labshelf.writing.checklist.removeItem", (node: ChecklistNode) => view.removeItem(node)),
    command(NEXT_STATUS_COMMAND, (node: ChecklistNode) => view.nextStatus(node)),
    command("labshelf.writing.checklist.runCheck", () => vscode.commands.executeCommand(CHECK_COMMAND, session.project)),
  );
}
