// Creates the open project's Checklist and describes it for the sidebar mirror.
import * as vscode from "vscode";

import { updateChecklist, type ILogger, type PaperStatus } from "@labshelf/core";
import { CHECK_COMMAND } from "../check/index.js";
import type { BuildPreviews } from "../preview/index.js";
import type { ProjectReadingLists } from "../readingList/index.js";
import type { ProjectSession, WritingProjects } from "../session/index.js";
import type { BuiltTreeSpec } from "../sidebar/index.js";
import { ChecklistView } from "./checklistView.js";
import { OpenProjectSignals } from "./openProjectSignals.js";
import { signalsReader } from "./signalsReader.js";

export interface ChecklistViewRegistration {
  context: vscode.ExtensionContext;
  session: ProjectSession;
  projects: Pick<WritingProjects, "reads" | "paths">;
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
    session, readSignals: signalsReader(deps.projects), onDidSaveTextDocument: vscode.workspace.onDidSaveTextDocument,
    onDidCountBodyPages: deps.previews.onDidCountBodyPages, logger, paths: deps.projects.paths,
  });
  const view = new ChecklistView({
    signals,
    paths: deps.projects.paths,
    reading: { of: (project) => deps.readingLists.of(project), onDidChange: deps.onDidChangeBacklinks },
    memory: context.workspaceState,
    setStatus: deps.setStatus,
    updateChecklist: (folder, edit) => updateChecklist(deps.projects.reads(logger), folder, edit),
    logger,
    newId: () => globalThis.crypto.randomUUID(),
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
