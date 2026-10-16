// Finds what the Library view offers to continue: the paper read last and the project file edited last.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";

import {
  createSidecarReader, lastReadPaper, type ILogger, type PaperRecord, type SidecarSummarySource,
} from "@labshelf/core";
import { latestProjectEdit } from "@labshelf/core/node";

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

async function projectTarget(library: ContinueLibrary, projects: WritingProjects): Promise<ContinueTarget | undefined> {
  const edit = await latestProjectEdit(projects.list(), library.logger);
  if (!edit) { return undefined; }
  const file = path.join(edit.folder, ...edit.cursor.file.split("/"));
  if (!(await fs.stat(file).then((stat) => stat.isFile(), () => false))) { return undefined; }
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
