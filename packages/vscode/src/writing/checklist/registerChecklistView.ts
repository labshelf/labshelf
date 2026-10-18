// Creates the open project's Checklist and describes it for the sidebar mirror.
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

import { updateChecklist, type ILogger, type PaperStatus } from "@labshelf/core";
import { nodeProjectReadContext } from "@labshelf/core/node";
import { CHECK_COMMAND } from "../check/index.js";
import type { BuildPreviews } from "../preview/index.js";
import type { ProjectReadingLists } from "../readingList/index.js";
import type { ProjectSession } from "../session/index.js";
import type { BuiltTreeSpec } from "../sidebar/index.js";
import { ChecklistView } from "./checklistView.js";
import { OpenProjectSignals } from "./openProjectSignals.js";
import { readSignalsOnDisk } from "./readSignalsOnDisk.js";

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
}

/** @returns the Checklist as the sidebar mirrors it */
export function registerChecklistView(deps: ChecklistViewRegistration): BuiltTreeSpec {
  const { context, session, logger } = deps;
  const signals = new OpenProjectSignals({
    session, readSignals: readSignalsOnDisk, onDidSaveTextDocument: vscode.workspace.onDidSaveTextDocument,
    onDidCountBodyPages: deps.previews.onDidCountBodyPages, logger,
  });
  const view = new ChecklistView({
    signals,
    reading: { of: (project) => deps.readingLists.of(project), onDidChange: deps.onDidChangeBacklinks },
    memory: context.workspaceState,
    setStatus: deps.setStatus,
    updateChecklist: (folder, edit) => updateChecklist(nodeProjectReadContext(logger), folder, edit),
    logger,
    newId: randomUUID,
    now: () => new Date(),
  });
  const command = vscode.commands.registerCommand;
  context.subscriptions.push(
    signals,
    view,
    command("labshelf.writing.checklist.addItem", () => view.addItem()),
    command("labshelf.writing.checklist.runCheck", () => vscode.commands.executeCommand(CHECK_COMMAND, session.project)),
  );
  return {
    view: "checklist", title: "Checklist", empty: "Nothing to do.",
    onDidChange: view.onDidChange,
    nodes: () => view.nodes(),
    toggle: () => ({
      options: [
        { action: "byKind", label: "By kind", run: () => view.setGrouping("kind") },
        { action: "bySection", label: "By section", run: () => view.setGrouping("section") },
      ],
      selected: view.grouping === "kind" ? "byKind" : "bySection",
    }),
    actions: [],
    handle: (request) => view.handle(request),
  };
}
