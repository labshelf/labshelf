/**
 * Answers the consult window's requests (plan local-sync D8): the lists its chooser shows, a paper's PDF and marks, Browse… and the open of a chosen
 * file. A note, manuscript or code file is not read here: the host opens it editable through an EditableFile. Hosts give only the IO.
 */

import { formatError } from "../../errors/index.js";
import type { Annotation, PaperRecord } from "../../model/index.js";
import type { ReadyProject } from "../project/index.js";
import type { ConsultContext, ConsultEntry, ConsultKind, ConsultRef, ConsultReply, ConsultRequest } from "./consultRequests.js";

/** The host's access to the library, its writing projects and its code files. */
export interface ConsultIo {
  listPapers(): Promise<PaperRecord[]>;
  paperPdfBase64(paper: PaperRecord): Promise<string>;
  annotationsOf(paperId: string): Promise<Annotation[]>;
  paperNotesText(paperId: string): Promise<string | null>;
  paperIdsWithNotes(): Promise<string[]>;
  projects(): Promise<ReadyProject[]>;
  /** Every file of the project, as project-relative '/' paths (as ReaderCiteIo's). */
  listFiles(project: ReadyProject): Promise<string[]>;
  /** The project's note files, as project-relative paths. */
  projectNotes?(project: ReadyProject): Promise<string[]>;
  listCodeFiles(): Promise<string[]>;
  /** Lets the user pick a file; null when they cancel. */
  browse?(): Promise<{ id?: string; path?: string; name: string } | null>;
  open?(ref: ConsultRef): Promise<void>;
}

const MANUSCRIPT_EXTENSIONS = [".tex", ".typ", ".md", ".qmd", ".bib"];

const hasManuscriptExtension = (path: string): boolean => {
  const lower = path.toLowerCase();
  return MANUSCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

const isUnsafeManuscriptPath = (path: string): boolean =>
  path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes("..");

const projectTitle = (project: ReadyProject): string => project.settings.title ?? project.settings.id;

function paperDetail(paper: PaperRecord): string | undefined {
  const parts = [paper.citeKey ? `@${paper.citeKey}` : "", paper.year === undefined ? "" : String(paper.year)].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

const byTitle = (a: PaperRecord, b: PaperRecord): number => a.title.localeCompare(b.title);

async function listPapers(io: ConsultIo): Promise<ConsultEntry[]> {
  return [...(await io.listPapers())].sort(byTitle).map((paper) => {
    const detail = paperDetail(paper);
    return { ref: { kind: "paper", paperId: paper.id }, label: paper.title, ...(detail === undefined ? {} : { detail }) };
  });
}

async function listNotes(io: ConsultIo, context: ConsultContext): Promise<ConsultEntry[]> {
  const withNotes = new Set(await io.paperIdsWithNotes());
  const entries: ConsultEntry[] = (await io.listPapers()).filter((paper) => withNotes.has(paper.id)).sort(byTitle)
    .map((paper) => ({ ref: { kind: "paperNotes", paperId: paper.id }, label: paper.title, group: "Papers" }));
  if (io.projectNotes === undefined || context.projectId === undefined) { return entries; }
  const project = (await io.projects()).find((entry) => entry.settings.id === context.projectId);
  if (project === undefined) { return entries; }
  for (const path of await io.projectNotes(project)) {
    entries.push({ ref: { kind: "projectNote", projectId: project.settings.id, path }, label: path, group: projectTitle(project) });
  }
  return entries;
}

async function listManuscripts(io: ConsultIo, context: ConsultContext): Promise<ConsultEntry[]> {
  const projects = [...(await io.projects())].sort((a, b) => projectTitle(a).localeCompare(projectTitle(b)));
  const first = projects.findIndex((project) => project.settings.id === context.projectId);
  if (first > 0) { projects.unshift(...projects.splice(first, 1)); }
  const entries: ConsultEntry[] = [];
  for (const project of projects) {
    const files = (await io.listFiles(project)).filter(hasManuscriptExtension).sort((a, b) => a.localeCompare(b));
    for (const path of files) {
      entries.push({ ref: { kind: "manuscript", projectId: project.settings.id, path }, label: path, group: projectTitle(project) });
    }
  }
  return entries;
}

async function listCode(io: ConsultIo): Promise<ConsultEntry[]> {
  return (await io.listCodeFiles()).map((path) => ({ ref: { kind: "code", path }, label: path.split("/").pop() ?? path, detail: path }));
}

function listEntries(io: ConsultIo, context: ConsultContext, what: ConsultKind): Promise<ConsultEntry[]> {
  switch (what) {
    case "paper": return listPapers(io);
    case "notes": return listNotes(io, context);
    case "manuscript": return listManuscripts(io, context);
    case "code": return listCode(io);
  }
}

async function findPaper(io: ConsultIo, paperId: string): Promise<PaperRecord | undefined> {
  return (await io.listPapers()).find((paper) => paper.id === paperId);
}

async function browse(io: ConsultIo): Promise<ConsultReply> {
  if (io.browse === undefined) { return { ok: false, error: "Browse is not available" }; }
  const picked = await io.browse();
  if (picked === null) { return { ok: true, value: { kind: "picked", entry: null } }; }
  if (picked.path !== undefined) {
    return { ok: true, value: { kind: "picked", entry: { ref: { kind: "code", path: picked.path }, label: picked.name, detail: picked.path } } };
  }
  const id = picked.id ?? picked.name;
  return { ok: true, value: { kind: "picked", entry: { ref: { kind: "pickedFile", id, name: picked.name }, label: picked.name } } };
}

async function open(io: ConsultIo, ref: ConsultRef): Promise<ConsultReply> {
  if (io.open === undefined) { return { ok: false, error: "Open is not available" }; }
  if (ref.kind === "manuscript" && (isUnsafeManuscriptPath(ref.path) || !hasManuscriptExtension(ref.path))) {
    return { ok: false, error: "Not a manuscript" };
  }
  await io.open(ref);
  return { ok: true, value: { kind: "opened" } };
}

async function answer(io: ConsultIo, context: ConsultContext, request: ConsultRequest): Promise<ConsultReply> {
  switch (request.kind) {
    case "list": {
      const entries = await listEntries(io, context, request.what);
      return { ok: true, value: { kind: "entries", entries, canBrowse: request.what === "code" && io.browse !== undefined } };
    }
    case "paperPdf": {
      const paper = await findPaper(io, request.paperId);
      return paper ? { ok: true, value: { kind: "pdf", base64: await io.paperPdfBase64(paper) } } : { ok: false, error: "Paper not found" };
    }
    case "paperMarks": {
      if (!(await findPaper(io, request.paperId))) { return { ok: false, error: "Paper not found" }; }
      const [annotations, notesText] = await Promise.all([io.annotationsOf(request.paperId), io.paperNotesText(request.paperId)]);
      return { ok: true, value: { kind: "marks", annotations, notesText } };
    }
    case "browse":
      return browse(io);
    case "open":
      return open(io, request.ref);
  }
}

/** Answers one request of the consult window; an IO failure becomes an error reply, never a rejection. */
export async function answerConsult(io: ConsultIo, context: ConsultContext, request: ConsultRequest): Promise<ConsultReply> {
  try {
    return await answer(io, context, request);
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}
