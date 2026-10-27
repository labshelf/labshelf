// Finds which sections and projects cite each paper: the citation workspace the providers share, the per-project sections cache and the project backlink index.
import * as vscode from "vscode";

import {
  createDebouncer,
  createSectionPlacer,
  deriveCitationSections,
  isInside,
  type Annotation,
  type BacklinkMap,
  type ChecklistSection,
  type ChecklistSource,
  type ILogger,
  type OpenSources,
  type PaperRecord,
  type PathOps,
} from "@labshelf/core";
import { disposeAll } from "../../disposables/index.js";
import { findOwningProject, type ProjectFinder, type ReadyProject } from "../projects/index.js";
import type { WritingHost, WritingProjects } from "../projects/index.js";

export interface CitationSession {
  listPapers(): Promise<PaperRecord[]>;
  /** The paper's annotations; the page-argument completion keeps the highlights that have text. */
  highlightsOf(paperId: string): Promise<Annotation[]>;
  /** Which sections of the project cite each key, from its saved sources. */
  citeSections(project: ReadyProject): Promise<CitationSections>;
  logger: ILogger;
}

/** What the providers read per request: the open library, if any, and the project list. */
export interface CitationWorkspace {
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
  session(): CitationSession | undefined;
}

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;

/** The ready project that owns the file as one of its sources; a source in the other format is not one. */
export function findCitingProject(projects: ProjectFinder, file: string): ReadyProject | undefined {
  const project = findOwningProject(projects, file);
  return project && projects.paths.extname(file) === SOURCE_EXTENSION[project.settings.format] ? project : undefined;
}

function openDocument(file: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && document.uri.fsPath === file);
}

export const openEditorSources: OpenSources = {
  text: (file) => openDocument(file)?.getText(),
  // The edit is left unsaved so the user decides when the main file reaches disk.
  async replace(file, text) {
    const document = openDocument(file);
    if (!document) { return false; }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    return vscode.workspace.applyEdit(edit);
  },
};

export interface CitationSections {
  /** The sections that cite each key, in source order. */
  byKey: ReadonlyMap<string, readonly ChecklistSection[]>;
  /** The section of a line (zero-based) in an absolute file path of the project. */
  sectionAt(file: string, line: number): ChecklistSection | undefined;
}

export interface CitationSectionsCacheDeps {
  /** The main file first, then the files it includes. */
  readSources(project: ReadyProject, logger: ILogger): Promise<ChecklistSource[]>;
  onDidSaveTextDocument: vscode.Event<vscode.TextDocument>;
  paths: PathOps;
}

export class CitationSectionsCache implements vscode.Disposable {
  private readonly entries = new Map<string, Promise<CitationSections>>();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: CitationSectionsCacheDeps) {
    this.subscription = deps.onDidSaveTextDocument((document) => this.forget(document.uri.fsPath));
  }

  /** A failed read is not cached, so the next request reads again. */
  get(project: ReadyProject, logger: ILogger): Promise<CitationSections> {
    let entry = this.entries.get(project.folder);
    if (!entry) {
      entry = this.build(project, logger);
      this.entries.set(project.folder, entry);
      entry.catch(() => this.entries.delete(project.folder));
    }
    return entry;
  }

  dispose(): void {
    this.subscription.dispose();
    this.entries.clear();
  }

  private async build(project: ReadyProject, logger: ILogger): Promise<CitationSections> {
    const sources = await this.deps.readSources(project, logger);
    const main = project.main ?? "";
    const { paths } = this.deps;
    const place = createSectionPlacer(sources, main);
    const relative = (file: string): string => paths.relative(project.folder, file).split(paths.sep).join("/");
    return { byKey: deriveCitationSections(sources, main), sectionAt: (file, line) => place(relative(file), line) };
  }

  private forget(file: string): void {
    for (const folder of this.entries.keys()) {
      if (isInside(this.deps.paths, folder, file)) { this.entries.delete(folder); }
    }
  }
}


const REBUILD_DEBOUNCE_MS = 1000;
const SOURCE_FILE = /\.(tex|typ)$/;

export class ProjectBacklinks implements vscode.Disposable {
  private built: BacklinkMap = new Map();
  private rebuildCount = 0;
  private readonly rebuildSoon = createDebouncer(() => void this.rebuild(), REBUILD_DEBOUNCE_MS);
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly projects: Pick<WritingProjects, "list" | "onDidChange" | "paths" | "data">, private readonly host: Pick<WritingHost, "current">) {
    const onDocument = (document: vscode.TextDocument): void => {
      if (this.isProjectSource(document)) { this.schedule(); }
    };
    this.subscriptions = [
      projects.onDidChange(() => this.schedule()),
      vscode.workspace.onDidSaveTextDocument(onDocument),
      vscode.workspace.onDidChangeTextDocument((event) => onDocument(event.document)),
    ];
  }

  /** The index as last built; empty until the first rebuild finishes. */
  index(): BacklinkMap {
    return this.built;
  }

  /** The folder of the ready project with this id. */
  projectFolder(id: string): string | undefined {
    for (const entry of this.projects.list()) { if (entry.kind === "ready" && entry.settings.id === id) { return entry.folder; } }
    return undefined;
  }

  private isProjectSource(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== "file" || !SOURCE_FILE.test(document.uri.fsPath)) { return false; }
    return this.projects.list().some((entry) => entry.kind === "ready" && document.uri.fsPath.startsWith(entry.folder + this.projects.paths.sep));
  }

  private schedule(): void {
    this.rebuildSoon.call();
  }

  private async rebuild(): Promise<void> {
    const ticket = ++this.rebuildCount;
    const logger = this.host.current()?.logger;
    let index: BacklinkMap = new Map();
    if (logger) {
      try {
        index = await this.projects.data.projectBacklinks(this.projects.list(), openEditorSources);
      } catch (error) {
        await logger.error("writing/citations", error, { action: "rebuild" });
        return;
      }
    }
    // A slower, older rebuild must not overwrite a newer result.
    if (ticket !== this.rebuildCount) { return; }
    this.built = index;
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.rebuildSoon.cancel();
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }
}
