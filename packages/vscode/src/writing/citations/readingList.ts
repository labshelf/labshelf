// Keeps a project's reading list: builds it from the backlink index and the project's papers: entries, and registers Add Paper to Reading List, which writes the papers key of labshelf.yaml.
import * as vscode from "vscode";

import {
  buildReadingList,
  derivePapersByCiteKey,
  type BacklinkMap,
  type ILogger,
  type PaperRecord,
  type ProjectEntry,
  type ReadingList,
} from "@labshelf/core";
import { createPaperPickItem, runSafely } from "../../command/index.js";
import type { ReadyProject } from "../commands/index.js";
import type { WritingHost, WritingProjects } from "../projects/index.js";

/** The open library as the reading list needs it. */
interface ReadingListSession {
  listPapers(): Promise<PaperRecord[]>;
  /** True when the paper's reader sidecar holds a reading position. */
  isOpened(paperId: string): Promise<boolean>;
  logger: ILogger;
}

interface ReadingListSources {
  backlinks: { index(): BacklinkMap };
  session: () => ReadingListSession | undefined;
}

export class ProjectReadingLists {
  constructor(private readonly sources: ReadingListSources) {}

  /** The project's reading list; empty when no library is open or its papers cannot be read, after logging why. */
  async of(project: ReadyProject): Promise<ReadingList> {
    const session = this.sources.session();
    if (!session) { return { entries: [], neverOpened: 0 }; }
    try {
      return await buildReadingList({
        project: project.settings.id,
        backlinks: this.sources.backlinks.index(),
        listed: project.settings.papers ?? [],
        papersByKey: derivePapersByCiteKey(await session.listPapers()),
        isOpened: (paperId) => session.isOpened(paperId),
      });
    } catch (error) {
      await session.logger.error("writing/readingList", error, { action: "build", project: project.settings.id });
      return { entries: [], neverOpened: 0 };
    }
  }
}


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

async function addPaper(deps: ReadingListCommandsDeps, target: ProjectEntry | undefined): Promise<void> {
  const session = await deps.host.require();
  const project = target?.kind === "ready" ? latest(deps.projects, target.folder) : undefined;
  if (!session || !project) { return; }
  await runSafely(session.logger, "labshelf.writing.addToReadingList", async () => {
    // A paper the sync listed as cited can be added to pin it, so it stays when the sources stop citing it.
    const syncedKeys = new Set((project.settings.papers ?? []).filter((entry) => entry.cited).map((entry) => entry.key));
    const inList = new Set((await deps.readingLists.of(project)).entries.map((entry) => entry.key).filter((key) => !syncedKeys.has(key)));
    const choices = (await deps.listPapers()).filter((paper) => !inList.has(paper.citeKey))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(createPaperPickItem);
    if (choices.length === 0) {
      void vscode.window.showInformationMessage("Every paper in the library is already in this reading list.");
      return;
    }
    const chosen = await vscode.window.showQuickPick(choices, { placeHolder: `Add a paper to the reading list of ${project.settings.id}`, matchOnDescription: true, matchOnDetail: true });
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

export function registerReadingListCommands(deps: ReadingListCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.addToReadingList", (target?: ProjectEntry) => addPaper(deps, target)),
  );
}
