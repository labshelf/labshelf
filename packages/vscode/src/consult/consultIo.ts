// The VS Code ConsultIo a source editor panel answers its consult window with: the library's papers, their marks and notes, the writing projects' files and the workspace's code.
import * as vscode from "vscode";
import { createPaperFiles, serializeItemFile, type Annotation, type ConsultIo, type ItemFile, type PaperRecord, type ReadyProject } from "@labshelf/core";
import type { WritingProjects } from "../writing/projects/index.js";
import { browseCodeFile, listWorkspaceCodeFiles } from "../writing/codeSource.js";
import { paperPdf } from "../writing/sourceEditor/bridges.js";

export interface VscodeConsultDeps {
  library: { listPapers(): Promise<PaperRecord[]> };
  projects: Pick<WritingProjects, "list" | "paths"> & { data: Pick<WritingProjects["data"], "listProjectFiles"> };
  /** A paper's highlights; without it a paper shows no marks. */
  highlightsOf?: ((paperId: string) => Promise<Annotation[]>) | undefined;
  /** The papers' notes: the store answers the parsed file, a plain reader its text. */
  paperNotes: { read(paperId: string): Promise<ItemFile | string> };
  /** The asking panel's project folder; absent for a file in no project, which then lists no code and offers no Browse…. */
  projectFolder?: string | undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(file));
    return true;
  } catch {
    return false;
  }
}

export function createVscodeConsultIo(deps: VscodeConsultDeps): ConsultIo {
  const { library, projects, paperNotes, projectFolder } = deps;
  const projectRoot = projectFolder === undefined ? undefined : vscode.Uri.file(projectFolder);
  const listFiles = (project: ReadyProject): Promise<string[]> => projects.data.listProjectFiles(project.folder);
  const io: ConsultIo = {
    listPapers: () => library.listPapers(),
    paperPdfBase64: (paper) => paperPdf({ library, citations: { store: { paths: projects.paths } } }, paper.id),
    annotationsOf: async (paperId) => (await deps.highlightsOf?.(paperId)) ?? [],
    async paperNotesText(paperId) {
      const notes = await paperNotes.read(paperId);
      const text = typeof notes === "string" ? notes : serializeItemFile(notes);
      return text === "" ? null : text;
    },
    async paperIdsWithNotes() {
      const papers = await library.listPapers();
      const found = await Promise.all(papers.map((paper) => exists(createPaperFiles(paper.path, projects.paths.join).notes)));
      return papers.filter((_, index) => found[index]).map((paper) => paper.id);
    },
    projects: async () => projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready"),
    listFiles,
    projectNotes: async (project) => (await listFiles(project)).filter((file) => file.toLowerCase().endsWith(".qmd")),
    listCodeFiles: async () => (projectRoot ? listWorkspaceCodeFiles(projectRoot) : []),
    open: async () => undefined,
  };
  if (projectRoot) {
    io.browse = async () => {
      const path = await browseCodeFile(projectRoot);
      return path === undefined ? null : { path, name: path.slice(path.lastIndexOf("/") + 1) };
    };
  }
  return io;
}
