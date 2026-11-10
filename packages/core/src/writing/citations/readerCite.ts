/**
 * Answers the cite popup (plan reader-cite-popup D1, D2): the projects and source files it can insert into, a file's text, the text written at a
 * clicked place, and the paper added to labshelf.bib. What it writes is a citation of the reader's paper or a linked code listing. Hosts give only the IO.
 */

import { formatError } from "../../errors/index.js";
import type { PaperRecord } from "../../model/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ProjectFormat, type ReadyProject } from "../project/index.js";
import { sourceExtensionOf } from "../project/buildRoot.js";
import { buildCodeInsert, deriveListingStyle, type CodeExcerpt } from "../codeLinks/index.js";
import { placeBlockAt } from "../noteLinks/index.js";
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
  /** `insert`, for a code listing only, is the listing built for this file, which the popup shows at the clicked place. */
  | { kind: "source"; text: string; version: string; insert?: string }
  /** `citation` is the text written; `hint`, for a listing, says what the manuscript still needs to compile it. */
  | { kind: "inserted"; path: string; citation: string; hint?: string }
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

/** What the popup writes: a citation of the reader's paper, or a listing of code linked to its file. */
export type ManuscriptInsert =
  | { kind: "citation"; paper: PaperRecord }
  /** `excerpt.path` is ignored: the listing records `pathIn(project)`, the code file's POSIX path relative to the picked project's folder (`../` allowed). */
  | { kind: "code"; excerpt: CodeExcerpt; pathIn(project: ReadyProject): string };

const LISTINGS_HINT = "Add \\usepackage{listings} to the preamble so the listing compiles.";

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

async function listTargets(io: ReaderCiteIo, subject: ManuscriptInsert): Promise<CiteReply> {
  const rows = await Promise.all((await io.projects()).map(async (project) => {
    const { settings } = project;
    const { files, hasRecent } = await listSourceFiles(io, project);
    const row: CiteProject = {
      id: settings.id,
      title: settings.title ?? settings.id,
      format: settings.format,
      bibliography: settings.bibliography ?? DEFAULT_BIBLIOGRAPHY,
      // A listing adds nothing to the bibliography.
      inBibliography: subject.kind === "citation" ? isInProjectBibliography(settings, subject.paper) : true,
      files,
    };
    return { row, hasRecent };
  }));
  return { kind: "targets", projects: [...rows.filter((r) => r.hasRecent), ...rows.filter((r) => !r.hasRecent)].map((r) => r.row) };
}

/** The listing for a source file of the project: minted when the file or a main file of the project (one with \documentclass) loads it, else listings; a raw block in Typst. */
async function buildListingFor(
  io: ReaderCiteIo, project: ReadyProject, path: string, text: string, subject: Extract<ManuscriptInsert, { kind: "code" }>,
): Promise<{ listing: string; hint?: string }> {
  const excerpt = { ...subject.excerpt, path: subject.pathIn(project) };
  if (project.settings.format === "typst") { return { listing: await buildCodeInsert("typst", "listings", excerpt) }; }
  const texts = [text];
  for (const file of (await io.listFiles(project)).filter((each) => each !== path && each.toLowerCase().endsWith(".tex"))) {
    const content = await io.read(project, file);
    if (content.includes("\\documentclass")) { texts.push(content); }
  }
  const { style, needsPackage } = deriveListingStyle(texts);
  return { listing: await buildCodeInsert("latex", style, excerpt), ...(needsPackage ? { hint: LISTINGS_HINT } : {}) };
}

async function insertText(io: ReaderCiteIo, subject: ManuscriptInsert, request: Extract<CiteRequest, { kind: "insert" }>): Promise<CiteReply> {
  const project = await findSource(io, request.projectId, request.path);
  const raw = await io.read(project, request.path);
  if (hashText(raw) !== request.version) {
    const what = subject.kind === "citation" ? "the citation" : "the code";
    return { kind: "error", message: `${request.path} changed; click again where ${what} goes`, stale: true };
  }
  const at = toRawOffset(raw, request.offset);
  if (subject.kind === "code") {
    const text = raw.replace(/\r\n/g, "\n");
    const { listing, hint } = await buildListingFor(io, project, request.path, text, subject);
    const block = placeBlockAt(text, Math.min(request.offset, text.length), listing);
    await io.insert(project, request.path, at, raw.includes("\r\n") ? block.replace(/\n/g, "\r\n") : block);
    return { kind: "inserted", path: request.path, citation: listing, ...(hint === undefined ? {} : { hint }) };
  }
  const { paper } = subject;
  const citation = createReaderCitation(
    project.settings.format, paper.citeKey,
    { page: request.page, quote: request.quote },
    request.quoted && request.quote !== undefined && request.quote !== "",
  );
  await io.insert(project, request.path, at, citation);
  await io.refreshBibliography(project, request.path);
  return { kind: "inserted", path: request.path, citation };
}

async function answer(io: ReaderCiteIo, subject: ManuscriptInsert, request: CiteRequest): Promise<CiteReply> {
  switch (request.kind) {
    case "targets":
      return listTargets(io, subject);
    case "read": {
      const project = await findSource(io, request.projectId, request.path);
      const raw = await io.read(project, request.path);
      const text = raw.replace(/\r\n/g, "\n");
      if (subject.kind === "citation") { return { kind: "source", text, version: hashText(raw) }; }
      const { listing } = await buildListingFor(io, project, request.path, text, subject);
      return { kind: "source", text, version: hashText(raw), insert: listing };
    }
    case "insert":
      return insertText(io, subject, request);
    case "bibliography": {
      if (subject.kind === "code") { throw new Error("A code listing adds nothing to the bibliography"); }
      const project = await findProject(io, request.projectId);
      await io.addToBibliography(project, subject.paper);
      return { kind: "listed", bibliography: project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY };
    }
  }
}

/**
 * Answers one request of the cite popup that writes `subject`.
 * @returns the reply; a failure of `io`, an unknown project or a path outside the project's source files is an error reply
 */
export async function answerManuscriptInsert(io: ReaderCiteIo, subject: ManuscriptInsert, request: CiteRequest): Promise<CiteReply> {
  try {
    return await answer(io, subject, request);
  } catch (error) {
    return { kind: "error", message: formatError(error) };
  }
}

/** Answers one request of the reader's cite popup for `paper`, the paper the reader shows. */
export function answerReaderCite(io: ReaderCiteIo, paper: PaperRecord, request: CiteRequest): Promise<CiteReply> {
  return answerManuscriptInsert(io, { kind: "citation", paper }, request);
}
