// Registers Add Paper to Reading List and Remove from Reading List, which write the papers key of labshelf.yaml.
import * as vscode from "vscode";

import type { PaperRecord, ProjectEntry } from "@labshelf/core";
import { executeSafely } from "../../commands/index.js";
import type { ReadyProject } from "../figures/index.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
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
    // A paper the sync listed as cited can be added to pin it, so it stays when the sources stop citing it.
    const syncedKeys = new Set((project.settings.papers ?? []).filter((entry) => entry.cited).map((entry) => entry.key));
    const inList = new Set((await deps.readingLists.of(project)).entries.map((entry) => entry.key).filter((key) => !syncedKeys.has(key)));
    const choices = (await deps.listPapers()).filter((paper) => !inList.has(paper.citeKey))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((paper) => ({ label: paper.title, description: paper.citeKey, paper }));
    if (choices.length === 0) {
      void vscode.window.showInformationMessage("Every paper in the library is already in this reading list.");
      return;
    }
    const chosen = await vscode.window.showQuickPick(choices, { placeHolder: `Add a paper to the reading list of ${project.settings.id}`, matchOnDescription: true });
    if (!chosen) { return; }
    const { citeKey, doi } = chosen.paper;
    const papers = project.settings.papers ?? [];
    const manual = (known: string | undefined) => known ?? doi ? { key: citeKey, doi: known ?? doi } : { key: citeKey };
    const listed = syncedKeys.has(citeKey)
      ? papers.map((entry) => entry.key === citeKey && entry.cited ? manual(entry.doi) : entry)
      : [...papers, manual(undefined)];
    await deps.projects.data.updateProjectSettings(project.folder, { papers: listed });
    await deps.projects.reload();
  });
}

async function removePaper(deps: ReadingListCommandsDeps, node: ReadingPaperNode | undefined): Promise<void> {
  const session = deps.host.current();
  const project = node?.kind === "readingPaper" ? latest(deps.projects, node.project.folder) : undefined;
  if (!session || !node || !project || node.entry.cited) { return; }
  await executeSafely(session.logger, "labshelf.writing.removeFromReadingList", async () => {
    const remaining = (project.settings.papers ?? []).filter((entry) => entry.key !== node.entry.key);
    await deps.projects.data.updateProjectSettings(project.folder, { papers: remaining.length > 0 ? remaining : undefined });
    await deps.projects.reload();
  });
}

export function registerReadingListCommands(deps: ReadingListCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.addToReadingList", (target?: ProjectEntry | ReadingListNode) => addPaper(deps, target)),
    vscode.commands.registerCommand("labshelf.writing.removeFromReadingList", (node?: ReadingPaperNode) => removePaper(deps, node)),
  );
}
