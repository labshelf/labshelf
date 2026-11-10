// Marks the lines citing a paper with notes by an "N notes" line above them, as VS Code's code lens does, and the popover of the latest ones.
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { citeSiteNotes, derivePapersByCiteKey, findCitationSites, type CiteSiteNotes, type ILogger, type ItemFile, type ItemSegment, type PaperRecord } from "../../../index.js";
import { QMD_VOCABULARY } from "../../../qmd/dom/index.js";
import { toggleLinePopover } from "../../../ui/dom/index.js";
import type { SourceLanguage } from "./formatting.js";

/** A cite site of the open file whose paper has notes, with what the popover shows of them. */
interface NoteSite extends CiteSiteNotes {
  paperId: string;
  /** The first line of each of the paper's last items, newest last. */
  latest: readonly string[];
}

export interface NoteGutter {
  extension: Extension;
  /** Replaces the marked lines; until the next call the markers follow the lines through edits. */
  setSites(view: EditorView, sites: readonly NoteSite[]): void;
}

export interface NoteGutterOptions {
  /** Opens the paper's notes where the library page does; without it the popover has no such button. */
  openNotes?(paperId: string): void;
}

/** One paper cited on a marked line. */
interface LinePaper { citeKey: string; paperId: string; notes: number; latest: readonly string[] }

/** "1 note", "3 notes". */
function formatNoteCount(count: number): string {
  // Read when a marker is drawn, so a host that stubs the DOM module still loads this file.
  return `${count} ${QMD_VOCABULARY.item}${count === 1 ? "" : "s"}`;
}

/** Groups the sites by line, one entry per cited key on it. */
function groupByLine(sites: readonly NoteSite[]): Map<number, LinePaper[]> {
  const lines = new Map<number, LinePaper[]>();
  for (const site of sites) {
    const papers = lines.get(site.line) ?? [];
    if (!papers.some((paper) => paper.citeKey === site.citeKey)) {
      papers.push({ citeKey: site.citeKey, paperId: site.paperId, notes: site.notes, latest: site.latest });
    }
    lines.set(site.line, papers);
  }
  return lines;
}

// --- Popover ---

function renderPaper(paper: LinePaper, openNotes: ((paperId: string) => void) | undefined, close: () => void): HTMLElement {
  const section = document.createElement("section");
  section.className = "ls-note-popover-paper";
  const heading = document.createElement("div");
  heading.className = "ls-note-popover-key";
  heading.textContent = `@${paper.citeKey}`;
  section.append(heading);
  const list = document.createElement("ul");
  for (const line of paper.latest) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  section.append(list);
  if (openNotes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ls-btn ls-note-popover-open";
    button.textContent = "Open notes";
    button.addEventListener("click", () => { close(); openNotes(paper.paperId); });
    section.append(button);
  }
  return section;
}

// --- Lens ---

class NoteLens extends WidgetType {
  constructor(private readonly papers: readonly LinePaper[], private readonly openNotes: NoteGutterOptions["openNotes"]) { super(); }

  private get count(): number { return this.papers.reduce((sum, paper) => sum + paper.notes, 0); }

  eq(other: NoteLens): boolean {
    return other.openNotes === this.openNotes && other.papers.length === this.papers.length
      && other.papers.every((paper, index) => {
        const mine = this.papers[index]!;
        return paper.citeKey === mine.citeKey && paper.paperId === mine.paperId && paper.notes === mine.notes && paper.latest.join("\n") === mine.latest.join("\n");
      });
  }

  toDOM(view: EditorView): HTMLElement {
    const label = formatNoteCount(this.count);
    const lens = document.createElement("div");
    lens.className = "ls-note-lens";
    const button = document.createElement("button");
    button.className = "ls-note-marker";
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.textContent = label;
    // A button opens on click and on Enter or Space by itself.
    button.addEventListener("click", () => toggleLinePopover({
      host: view.dom, anchor: button, className: "ls-note-popover", label, fallbackFocus: view.contentDOM, place: "below",
      render: (close) => this.papers.map((paper) => renderPaper(paper, this.openNotes, close)),
    }));
    lens.append(button);
    return lens;
  }

  ignoreEvent(): boolean { return true; }
}

const setNoteSites = StateEffect.define<readonly NoteSite[]>();

function buildLenses(sites: readonly NoteSite[], doc: Text, openNotes: NoteGutterOptions["openNotes"]): DecorationSet {
  const ranges = [];
  for (const [line, papers] of groupByLine(sites)) {
    if (line < 0 || line + 1 > doc.lines) continue;
    ranges.push(Decoration.widget({ widget: new NoteLens(papers, openNotes), block: true, side: -1 }).range(doc.line(line + 1).from));
  }
  return Decoration.set(ranges, true);
}

/** The look of the lens and the popover: a small muted line in the UI font over the cited line, as VS Code's code lens. */
const noteTheme = EditorView.theme({
  ".ls-note-lens": { lineHeight: "1.6", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)", paddingLeft: "var(--ls-space-3)" },
  ".ls-note-marker": { padding: "0", border: "none", background: "none", color: "var(--ls-section-fg)", font: "inherit", cursor: "pointer" },
  ".ls-note-marker:hover": { color: "var(--ls-mark-accent)", textDecoration: "underline" },
  ".ls-note-marker:focus-visible": { outline: "thin solid var(--ls-focus)" },
  ".ls-note-popover-paper + .ls-note-popover-paper": { marginTop: "var(--ls-space-3)" },
  ".ls-note-popover-key": { fontWeight: "bold", color: "var(--ls-fg)" },
  ".ls-note-popover ul": { margin: "var(--ls-space-2) 0", paddingLeft: "var(--ls-space-6)" },
  ".ls-note-popover li": { color: "var(--ls-desc)", overflowWrap: "anywhere" },
});

export function createNoteGutter({ openNotes }: NoteGutterOptions = {}): NoteGutter {
  // A block widget changes the line heights, so it comes from a state field, never a view plugin.
  const lenses = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      let next = transaction.docChanged ? value.map(transaction.changes) : value;
      for (const effect of transaction.effects) {
        if (effect.is(setNoteSites)) next = buildLenses(effect.value, transaction.newDoc, openNotes);
      }
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return {
    extension: [lenses, noteTheme],
    setSites: (view, sites) => view.dispatch({ effects: setNoteSites.of(sites) }),
  };
}

const SITES_MODULE = "tabs.source";
const REFRESH_MODULE = "editor.mount";

const NOTE_PREVIEW_ITEMS = 3;
const NOTE_PREVIEW_CHARS = 120;

/** The first non-empty line of a note, cut to one short line. */
function firstNoteLine(body: string): string {
  const line = body.split(/\r\n|\n|\r/).map((part) => part.trim()).find((part) => part !== "") ?? "";
  return line.length <= NOTE_PREVIEW_CHARS ? line : `${line.slice(0, NOTE_PREVIEW_CHARS).trimEnd()}…`;
}

/** The notes of a paper as the lens shows them: how many items, and the first lines of the last ones. */
export function summarizeNotes(file: ItemFile): { notes: number; latest: string[] } {
  const items = file.segments.filter((segment): segment is ItemSegment => segment.kind === "item");
  return { notes: items.length, latest: items.slice(-NOTE_PREVIEW_ITEMS).map((item) => firstNoteLine(item.body)).filter((line) => line !== "") };
}

interface NoteSitesDeps {
  language: SourceLanguage;
  /** Project-relative path of the file. */
  path: string;
  papers(): Promise<readonly PaperRecord[]>;
  notes: { read(paperId: string): Promise<ItemFile> };
  logger: ILogger;
}

/** The cite sites of the text whose paper has notes. Reads each cited paper's notes once; a paper whose notes cannot be read counts as having none. */
async function loadNoteSites({ language, path, papers, notes, logger }: NoteSitesDeps, text: string): Promise<NoteSite[]> {
  const sites = findCitationSites(language, text);
  if (sites.length === 0) return [];
  const byKey = derivePapersByCiteKey(await papers());
  const summaries = new Map<string, { paperId: string; notes: number; latest: string[] }>();
  await Promise.all([...new Set(sites.map((site) => site.key))].map(async (key) => {
    const paper = byKey.get(key);
    if (!paper) return;
    try {
      summaries.set(key, { paperId: paper.id, ...summarizeNotes(await notes.read(paper.id)) });
    } catch (error) {
      void logger.error(SITES_MODULE, error, { action: "readPaperNotes", paperId: paper.id });
    }
  }));
  return citeSiteNotes(sites.map((site) => ({ file: path, line: site.line, key: site.key })), (key) => summaries.get(key)?.notes ?? 0)
    .map((site) => ({ ...site, paperId: summaries.get(site.citeKey)!.paperId, latest: summaries.get(site.citeKey)!.latest }));
}

export interface NoteRefreshDeps extends Omit<NoteSitesDeps, "notes"> {
  projectId: string;
  /** Without it no counts are loaded and no lens shows. */
  notes?: NoteSitesDeps["notes"] | undefined;
  view(): EditorView | undefined;
  text(): string;
}

/** Loads the lenses' sites when asked: when the file opens and after each save, never per keystroke. A later request wins over an earlier one still reading. */
export function createNoteRefresh(gutter: NoteGutter, { projectId, notes, view, text, ...sites }: NoteRefreshDeps): { refresh(): void; close(): void } {
  let request = 0;
  let closed = false;
  return {
    refresh() {
      if (!notes) return;
      const mine = ++request;
      loadNoteSites({ ...sites, notes }, text())
        .then((loaded) => { const current = view(); if (!closed && mine === request && current) gutter.setSites(current, loaded); })
        .catch((error: unknown) => sites.logger.error(REFRESH_MODULE, error, { action: "loadNoteSites", projectId, path: sites.path }));
    },
    close() { closed = true; },
  };
}
