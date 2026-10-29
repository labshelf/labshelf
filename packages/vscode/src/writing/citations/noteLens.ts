// Shows how many notes a cited paper has: a lens on the line that cites it, and the latest notes in the hover on the cite key.
import * as vscode from "vscode";

import { createLibraryLayout, findCiteKeyOccurrences, findCitationSites, type ItemFile, type ItemSegment } from "@labshelf/core";
import type { WritingProjects } from "../projects/index.js";
import { countNoteItems, findCitingProject, type NoteLibrary, type ProjectBacklinks } from "./backlinks.js";

const MODULE = "writing/citations";
const NOTE_WORD = "note"; // D16: QMD_VOCABULARY.item, which lives in the DOM entry of core
const HOVER_NOTES = 3;
const NOTE_LINE_CHARS = 120;
const TEXT_EDITOR = "default";

const SOURCES = [
  { scheme: "file", pattern: "**/*.tex" },
  { scheme: "file", pattern: "**/*.typ" },
];

export interface NoteLensDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "list" | "paths">;
  backlinks: ProjectBacklinks;
  /** The open library, if any; the counts come from it at each backlink refresh. */
  library: () => NoteLibrary | undefined;
}

const countLabel = (count: number): string => `${count} ${NOTE_WORD}${count === 1 ? "" : "s"}`;

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");

/** The first non-empty line of a note, cut to one short line. */
function firstLine(body: string): string {
  const line = body.split(/\r\n|\n|\r/).map((part) => part.trim()).find((part) => part !== "") ?? "";
  return line.length <= NOTE_LINE_CHARS ? line : `${line.slice(0, NOTE_LINE_CHARS).trimEnd()}…`;
}

/** The first lines of the last notes of the file, newest last. */
function lastNoteLines(file: ItemFile, count: number): string[] {
  const items = file.segments.filter((segment): segment is ItemSegment => segment.kind === "item");
  return items.slice(-count).map((item) => firstLine(item.body)).filter((line) => line !== "");
}

/** The notes.qmd of a paper in the library. */
function notesFile(deps: NoteLensDeps, library: NoteLibrary, paperId: string): vscode.Uri {
  return vscode.Uri.file(createLibraryLayout(library.root, deps.projects.paths.join).paperNotesPath(paperId));
}

class NoteLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: NoteLensDeps) {
    this.subscription = deps.backlinks.onDidChange(() => this.changeEmitter.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const project = findCitingProject(this.deps.projects, document.uri.fsPath);
    const library = this.deps.library();
    if (!project || !library) { return []; }
    const file = document.uri.fsPath;
    const sites = findCitationSites(project.settings.format, document.getText()).map((site) => ({ file, line: site.line, key: site.key }));
    // Per line, the notes of each cited paper once, in text order.
    const byLine = new Map<number, Map<string, number>>();
    for (const site of this.deps.backlinks.noteSites(sites)) {
      const keys = byLine.get(site.line) ?? new Map<string, number>();
      keys.set(site.citeKey, site.notes);
      byLine.set(site.line, keys);
    }
    const lenses: vscode.CodeLens[] = [];
    for (const [line, keys] of byLine) {
      for (const [key, notes] of keys) {
        const paperId = this.deps.backlinks.notesOf(key)?.paperId;
        if (!paperId) { continue; }
        lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: keys.size > 1 ? `@${key}: ${countLabel(notes)}` : countLabel(notes),
          tooltip: `Open the ${NOTE_WORD}s of ${key}`,
          command: "vscode.openWith",
          arguments: [notesFile(this.deps, library, paperId), TEXT_EDITOR],
        }));
      }
    }
    return lenses;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}

class NoteHoverProvider implements vscode.HoverProvider {
  constructor(private readonly deps: NoteLensDeps) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const project = findCitingProject(this.deps.projects, document.uri.fsPath);
    const library = this.deps.library();
    if (!project || !library) { return undefined; }
    const offset = document.offsetAt(position);
    const cited = findCiteKeyOccurrences(project.settings.format, document.getText())
      .find((candidate) => candidate.start <= offset && offset <= candidate.end);
    const known = cited && this.deps.backlinks.notesOf(cited.key);
    if (!cited || !known) { return undefined; }
    try {
      const file = await library.readNotes(known.paperId);
      const lines = lastNoteLines(file, HOVER_NOTES);
      if (lines.length === 0) { return undefined; }
            const markdown = new vscode.MarkdownString(`**${countLabel(countNoteItems(file))}**\n\n${lines.map((line) => `- ${escapeMarkdown(line)}`).join("\n")}`);
      return new vscode.Hover(markdown, new vscode.Range(document.positionAt(cited.start), document.positionAt(cited.end)));
    } catch (error) {
      await library.logger.error(MODULE, error, { action: "hover-notes" });
      return undefined;
    }
  }
}

/** Registers the "N notes" lens on the lines that cite a paper with notes, and the hover that lists its latest notes. */
export function registerNoteLens(deps: NoteLensDeps): void {
  const lens = new NoteLensProvider(deps);
  const hover = new NoteHoverProvider(deps);
  deps.context.subscriptions.push(
    lens,
    deps.backlinks.trackNotes(deps.library),
    vscode.languages.registerCodeLensProvider(SOURCES, lens),
    vscode.languages.registerHoverProvider(SOURCES, hover),
  );
}
