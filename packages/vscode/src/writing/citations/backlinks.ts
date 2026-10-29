// Finds which sections and projects cite each paper: the citation workspace the providers share, the per-project sections cache and the project backlink index.
import * as vscode from "vscode";

import {
  createDebouncer,
  citeSiteNotes,
  createSectionPlacer,
  deriveCitationSections,
  derivePapersByCiteKey,
  formatError,
  isInside,
  type Annotation,
  type BacklinkMap,
  type ChecklistSection,
  type ChecklistSource,
  type CiteSiteNotes,
  type ILogger,
  type ItemFile,
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

/** The open library as the "N notes" lens reads it: its papers and their notes. */
export interface NoteLibrary {
  root: string;
  logger: ILogger;
  listPapers(): Promise<PaperRecord[]>;
  readNotes(paperId: string): Promise<ItemFile>;
}

/** How many notes a cited paper has, and the paper's id. */
interface PaperNoteCount { paperId: string; notes: number }

/** The number of items in a notes file; loose text is not a note. */
export function countNoteItems(file: ItemFile): number {
  return file.segments.filter((segment) => segment.kind === "item").length;
}

export class ProjectBacklinks implements vscode.Disposable {
  private built: BacklinkMap = new Map();
  private noteCounts: ReadonlyMap<string, PaperNoteCount> = new Map();
  private noteLibrary: (() => NoteLibrary | undefined) | undefined;
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

  /**
   * Starts counting the notes of the cited papers at every refresh, from the library `library` returns.
   * @returns a disposable that stops it.
   */
  trackNotes(library: () => NoteLibrary | undefined): vscode.Disposable {
    this.noteLibrary = library;
    // Notes are added in the reader, so coming back to the window rereads them.
    const focus = vscode.window.onDidChangeWindowState((state) => { if (state.focused) { this.schedule(); } });
    this.schedule();
    return { dispose: () => { focus.dispose(); if (this.noteLibrary === library) { this.noteLibrary = undefined; } } };
  }

  /** The cite sites (file, zero-based line, key) whose cited paper has notes, as of the last refresh. */
  noteSites(sites: readonly { file: string; line: number; key: string }[]): CiteSiteNotes[] {
    return citeSiteNotes(sites, (key) => this.noteCounts.get(key)?.notes ?? 0);
  }

  /** The paper cited by this key and how many notes it had at the last refresh; absent when it has none. */
  notesOf(citeKey: string): PaperNoteCount | undefined {
    return this.noteCounts.get(citeKey);
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
    const counts = await this.countNotes(index);
    // A slower, older rebuild must not overwrite a newer result.
    if (ticket !== this.rebuildCount) { return; }
    this.built = index;
    this.noteCounts = counts;
    this.changeEmitter.fire();
  }

  /** Reads the notes of each cited paper once; a paper whose notes cannot be read counts 0 and is logged. */
  private async countNotes(index: BacklinkMap): Promise<Map<string, PaperNoteCount>> {
    const counts = new Map<string, PaperNoteCount>();
    const library = this.noteLibrary?.();
    if (!library || index.size === 0) { return counts; }
    let papers: Map<string, PaperRecord>;
    try {
      papers = derivePapersByCiteKey(await library.listPapers());
    } catch (error) {
      await library.logger.error("writing/citations", error, { action: "note-counts-papers" });
      return counts;
    }
    await Promise.all([...index.keys()].map(async (key) => {
      const paper = papers.get(key);
      if (!paper) { return; }
      try {
        const notes = countNoteItems(await library.readNotes(paper.id));
        if (notes > 0) { counts.set(key, { paperId: paper.id, notes }); }
      } catch (error) {
        await library.logger.log("WARN", "writing/citations", "paper notes unreadable", { paperId: paper.id, error: formatError(error) });
      }
    }));
    return counts;
  }

  dispose(): void {
    this.rebuildSoon.cancel();
    disposeAll(this.subscriptions);
    this.changeEmitter.dispose();
  }
}
