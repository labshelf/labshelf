/** Answers the reader's cite popup (plan reader-cite-popup D1, D2): the projects and source files it can cite in, a file's text, the citation written at a clicked place, and the paper added to labshelf.bib. Hosts give only the IO. */

import { formatError } from "../../errors/index.js";
import type { PaperRecord } from "../../model/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectFormat, type ReadyProject } from "../project/index.js";
import { sourceExtensionOf } from "../project/buildRoot.js";
import { createReaderCitation, isInProjectBibliography } from "./citeFromReader.js";

/** What the popup asks the host; projects are named by their settings id and files by their project-relative '/' path. */
export type CiteRequest =
  | { kind: "targets" }
  | { kind: "read"; projectId: string; path: string }
  /** `offset` counts `\n` line breaks in the text `read` returned; `version` is that reply's version. */
  | { kind: "insert"; projectId: string; path: string; version: string; offset: number; page?: number; quote?: string; quoted: boolean }
  | { kind: "bibliography"; projectId: string };

/** A project the popup offers, with its source files ordered recent, main, then alphabetical. */
export interface CiteProject {
  id: string;
  title: string;
  format: ProjectFormat;
  /** The file name of the project's bibliography. */
  bibliography: string;
  inBibliography: boolean;
  files: string[];
}

export type CiteReply =
  | { kind: "targets"; projects: CiteProject[] }
  /** `text` has its line breaks normalised to `\n`; `version` is a short hash of the raw text. */
  | { kind: "source"; text: string; version: string }
  | { kind: "inserted"; path: string; citation: string }
  | { kind: "listed"; bibliography: string }
  /** `stale` marks an insert refused because the file changed since it was read. */
  | { kind: "error"; message: string; stale?: true };

/** The host's access to its writing projects and their files. */
export interface ReaderCiteIo {
  projects(): Promise<ReadyProject[]>;
  /** Every file of the project, as project-relative '/' paths. */
  listFiles(project: ReadyProject): Promise<string[]>;
  /** The project's recently used files, most recent first; may be empty. */
  recentFiles(project: ReadyProject): string[];
  /** The file's current text, unsaved edits included. */
  read(project: ReadyProject, path: string): Promise<string>;
  /** Inserts `text` at `offset` of the raw text. */
  insert(project: ReadyProject, path: string, offset: number, text: string): Promise<void>;
  addToBibliography(project: ReadyProject, paper: PaperRecord): Promise<void>;
  refreshBibliography(project: ReadyProject, path: string): Promise<void>;
}

/** The source files of a project: recent ones first (most recent first), then the main file, then the rest alphabetically. */
async function listSourceFiles(io: ReaderCiteIo, project: ReadyProject): Promise<{ files: string[]; hasRecent: boolean }> {
  const extension = sourceExtensionOf(project.settings.format);
  const sources = (await io.listFiles(project)).filter((path) => path.toLowerCase().endsWith(extension));
  const available = new Set(sources);
  const ordered: string[] = [];
  const take = (path: string | undefined): void => {
    if (path !== undefined && available.has(path) && !ordered.includes(path)) { ordered.push(path); }
  };
  io.recentFiles(project).forEach(take);
  const hasRecent = ordered.length > 0;
  take(project.main);
  [...sources].sort((a, b) => a.localeCompare(b)).forEach(take);
  return { files: ordered, hasRecent };
}

async function findProject(io: ReaderCiteIo, projectId: string): Promise<ReadyProject> {
  const project = (await io.projects()).find((entry) => entry.settings.id === projectId);
  if (!project) { throw new Error("The project is no longer available"); }
  return project;
}

async function findSource(io: ReaderCiteIo, projectId: string, path: string): Promise<ReadyProject> {
  const project = await findProject(io, projectId);
  if (!(await listSourceFiles(io, project)).files.includes(path)) { throw new Error(`${path} is not a source file of the project`); }
  return project;
}

/** FNV-1a (32 bit) of the UTF-16 code units, with the length, as a short stable version of a text. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, "0")}`;
}

/** The raw offset of `offset` in the `\n`-normalised text: one more for each `\r\n` before it, clamped to the raw text. */
function toRawOffset(raw: string, offset: number): number {
  let index = 0;
  for (let count = 0; count < offset && index < raw.length; count++) {
    index += raw.startsWith("\r\n", index) ? 2 : 1;
  }
  return Math.min(index, raw.length);
}

async function listTargets(io: ReaderCiteIo, paper: PaperRecord): Promise<CiteReply> {
  const rows = await Promise.all((await io.projects()).map(async (project) => {
    const { settings } = project;
    const { files, hasRecent } = await listSourceFiles(io, project);
    const row: CiteProject = {
      id: settings.id,
      title: settings.title ?? settings.id,
      format: settings.format,
      bibliography: settings.bibliography ?? DEFAULT_BIBLIOGRAPHY,
      inBibliography: isInProjectBibliography(settings, paper),
      files,
    };
    return { row, hasRecent };
  }));
  return { kind: "targets", projects: [...rows.filter((r) => r.hasRecent), ...rows.filter((r) => !r.hasRecent)].map((r) => r.row) };
}

async function insertCitation(io: ReaderCiteIo, paper: PaperRecord, request: Extract<CiteRequest, { kind: "insert" }>): Promise<CiteReply> {
  const project = await findSource(io, request.projectId, request.path);
  const raw = await io.read(project, request.path);
  if (hashText(raw) !== request.version) {
    return { kind: "error", message: `${request.path} changed; click again where the citation goes`, stale: true };
  }
  const citation = createReaderCitation(
    project.settings.format, paper.citeKey,
    { page: request.page, quote: request.quote },
    request.quoted && request.quote !== undefined && request.quote !== "",
  );
  await io.insert(project, request.path, toRawOffset(raw, request.offset), citation);
  await io.refreshBibliography(project, request.path);
  return { kind: "inserted", path: request.path, citation };
}

async function answer(io: ReaderCiteIo, paper: PaperRecord, request: CiteRequest): Promise<CiteReply> {
  switch (request.kind) {
    case "targets":
      return listTargets(io, paper);
    case "read": {
      const project = await findSource(io, request.projectId, request.path);
      const raw = await io.read(project, request.path);
      return { kind: "source", text: raw.replace(/\r\n/g, "\n"), version: hashText(raw) };
    }
    case "insert":
      return insertCitation(io, paper, request);
    case "bibliography": {
      const project = await findProject(io, request.projectId);
      await io.addToBibliography(project, paper);
      return { kind: "listed", bibliography: project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY };
    }
  }
}

/**
 * Answers one request of the reader's cite popup for `paper`, the paper the reader shows.
 * @returns the reply; a failure of `io`, an unknown project or a path outside the project's source files is an error reply
 */
export async function answerReaderCite(io: ReaderCiteIo, paper: PaperRecord, request: CiteRequest): Promise<CiteReply> {
  try {
    return await answer(io, paper, request);
  } catch (error) {
    return { kind: "error", message: formatError(error) };
  }
}
