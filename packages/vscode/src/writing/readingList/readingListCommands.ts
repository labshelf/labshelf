// Registers Add Paper to Reading List and Remove from Reading List, which write the papers key of labshelf.yaml.
import * as vscode from "vscode";

import type { PaperRecord } from "@labshelf/core";
import { updateProjectSettings, type ProjectEntry } from "@labshelf/core/node";
import { executeSafely } from "../../commands/index.js";
import type { ReadyProject } from "../figures/index.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";
import type { ProjectReadingLists } from "./projectReadingLists.js";
import type { ReadingListNode, ReadingPaperNode } from "./readingListNodes.js";

interface ReadingListCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
  readingLists: Pick<ProjectReadingLists, "of">;
  listPapers: () => Promise<PaperRecord[]>;
}

/** The project as labshelf.yaml was last read, so a second add does not drop the first. */
function latest(projects: WritingProjects, folder: string): ReadyProject | undefined {
  const entry = projects.list().find((candidate) => candidate.folder === folder);
  return entry?.kind === "ready" ? entry : undefined;
}

async function addPaper(deps: ReadingListCommandsDeps, target: ProjectEntry | ReadingListNode | undefined): Promise<void> {
  const session = await deps.host.require();
  const picked = target?.kind === "readingList" ? target.project : target;
  const project = picked?.kind === "ready" ? latest(deps.projects, picked.folder) : undefined;
  if (!session || !project) { return; }
  await executeSafely(session.logger, "labshelf.writing.addToReadingList", async () => {
    const inList = new Set((await deps.readingLists.of(project)).entries.map((entry) => entry.key));
    const choices = (await deps.listPapers()).filter((paper) => !inList.has(paper.citeKey))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((paper) => ({ label: paper.title, description: paper.citeKey, paper }));
    if (choices.length === 0) {
      void vscode.window.showInformationMessage("Every paper in the library is already in this reading list.");
      return;
    }
    const chosen = await vscode.window.showQuickPick(choices, { placeHolder: `Add a paper to the reading list of ${project.settings.id}`, matchOnDescription: true });
    if (!chosen) { return; }
    const entry = chosen.paper.doi ? { key: chosen.paper.citeKey, doi: chosen.paper.doi } : { key: chosen.paper.citeKey };
    await updateProjectSettings(project.folder, { papers: [...project.settings.papers ?? [], entry] }, session.logger);
    await deps.projects.reload();
  });
}

async function removePaper(deps: ReadingListCommandsDeps, node: ReadingPaperNode | undefined): Promise<void> {
  const session = deps.host.current();
  const project = node?.kind === "readingPaper" ? latest(deps.projects, node.project.folder) : undefined;
  if (!session || !node || !project || node.entry.cited) { return; }
  await executeSafely(session.logger, "labshelf.writing.removeFromReadingList", async () => {
    const remaining = (project.settings.papers ?? []).filter((entry) => entry.key !== node.entry.key);
    await updateProjectSettings(project.folder, { papers: remaining.length > 0 ? remaining : undefined }, session.logger);
    await deps.projects.reload();
  });
}

export function registerReadingListCommands(deps: ReadingListCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.addToReadingList", (target?: ProjectEntry | ReadingListNode) => addPaper(deps, target)),
    vscode.commands.registerCommand("labshelf.writing.removeFromReadingList", (node?: ReadingPaperNode) => removePaper(deps, node)),
  );
}
