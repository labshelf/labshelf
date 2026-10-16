// Finds what the Library view offers to continue: the paper read last and the project file edited last.
import * as vscode from "vscode";

import {
  createSidecarReader, lastReadPaper, type ILogger, type PaperRecord, type SidecarSummarySource,
} from "@labshelf/core";

import type { WritingProjects } from "../writing/index.js";

const MODULE = "continue";

export type ContinueTarget =
  | { kind: "paper"; paperId: string; title: string; page: number }
  | { kind: "project"; projectId: string; file: string; relativeFile: string; line: number; character: number };

/** The open library as the Continue row reads it. */
export interface ContinueLibrary {
  root: string;
  logger: ILogger;
  listPapers: () => Promise<PaperRecord[]>;
  loadSidecar: (paperId: string) => Promise<SidecarSummarySource>;
}

/** What the Library view reads on every refresh, and the event that tells it a project cursor was saved. */
export interface ContinueSource {
  targets: () => Promise<ContinueTarget[]>;
  onDidChange: vscode.Event<void>;
}

async function paperTarget(library: ContinueLibrary): Promise<ContinueTarget | undefined> {
  const papers = await library.listPapers();
  const stats = await createSidecarReader(library.loadSidecar, library.logger, MODULE).statsOf(papers);
  const last = lastReadPaper(stats);
  const record = last && papers.find((paper) => paper.id === last.paperId);
  return last && record ? { kind: "paper", paperId: last.paperId, title: record.title || record.id, page: last.page } : undefined;
}

/** A missing, unreadable or non-file path all mean "nothing to continue to". */
async function isFile(file: string): Promise<boolean> {
  return vscode.workspace.fs.stat(vscode.Uri.file(file)).then((stat) => (stat.type & vscode.FileType.File) !== 0, () => false);
}

async function projectTarget(library: ContinueLibrary, projects: Pick<WritingProjects, "list" | "paths" | "data">): Promise<ContinueTarget | undefined> {
  const edit = await projects.data.latestProjectEdit(projects.list());
  if (!edit) { return undefined; }
  const file = projects.paths.join(edit.folder, ...edit.cursor.file.split("/"));
  if (!(await isFile(file))) { return undefined; }
  const { line, character } = edit.cursor;
  return { kind: "project", projectId: edit.id, file, relativeFile: edit.cursor.file, line, character };
}

/** A part that cannot be read is logged and left out, so the other still shows. */
export async function readContinueTargets(library: ContinueLibrary | undefined, projects: WritingProjects): Promise<ContinueTarget[]> {
  if (!library) { return []; }
  const guarded = async (part: string, read: () => Promise<ContinueTarget | undefined>): Promise<ContinueTarget | undefined> => {
    try {
      return await read();
    } catch (error) {
      await library.logger.error(MODULE, error, { part });
      return undefined;
    }
  };
  const found = await Promise.all([guarded("paper", () => paperTarget(library)), guarded("project", () => projectTarget(library, projects))]);
  return found.filter((target): target is ContinueTarget => target !== undefined);
}
