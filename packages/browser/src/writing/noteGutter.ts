// A CodeMirror gutter that marks the lines citing a paper with notes by "N notes", and the popover of the latest ones.
import { RangeSet, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import { citeSiteNotes, derivePapersByCiteKey, findCitationSites, type CiteSiteNotes, type ILogger, type ItemFile, type ItemSegment, type PaperRecord } from "@labshelf/core";
import { QMD_VOCABULARY, renderIcon } from "@labshelf/core/dom";
import type { SourceLanguage } from "./source";

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

const POPOVER_GAP_PX = 4;

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

interface OpenPopover { anchor: HTMLElement; close(): void }
// INVARIANT: at most one popover is open in the page.
let active: OpenPopover | undefined;

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

function placePopover(popover: HTMLElement, anchor: HTMLElement): void {
  const anchorBox = anchor.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const left = Math.max(0, Math.min(anchorBox.right + POPOVER_GAP_PX, window.innerWidth - box.width));
  const top = Math.max(0, Math.min(anchorBox.top, window.innerHeight - box.height));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function openPopover(view: EditorView, anchor: HTMLElement, papers: readonly LinePaper[], openNotes: NoteGutterOptions["openNotes"]): void {
  const toggledOff = active?.anchor === anchor;
  active?.close();
  if (toggledOff) return;
  const popover = document.createElement("div");
  popover.className = "ls-note-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", formatNoteCount(papers.reduce((sum, paper) => sum + paper.notes, 0)));
  popover.tabIndex = -1;
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("scroll", onScroll, true);
    const hadFocus = popover.contains(document.activeElement);
    popover.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (active?.anchor === anchor) active = undefined;
    if (hadFocus) (anchor.isConnected ? anchor : view.contentDOM).focus();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onPointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !popover.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onScroll = (event: Event): void => { if (!(event.target instanceof Node && popover.contains(event.target))) close(); };
  popover.append(...papers.map((paper) => renderPaper(paper, openNotes, close)));
  view.dom.append(popover);
  placePopover(popover, anchor);
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("scroll", onScroll, true);
  active = { anchor, close };
  popover.focus();
}

// --- Gutter ---

class NoteMarker extends GutterMarker {
  constructor(private readonly papers: readonly LinePaper[], private readonly openNotes: NoteGutterOptions["openNotes"]) { super(); }

  private get count(): number { return this.papers.reduce((sum, paper) => sum + paper.notes, 0); }

  eq(other: GutterMarker): boolean {
    return other instanceof NoteMarker && other.openNotes === this.openNotes && other.papers.length === this.papers.length
      && other.papers.every((paper, index) => {
        const mine = this.papers[index]!;
        return paper.citeKey === mine.citeKey && paper.paperId === mine.paperId && paper.notes === mine.notes && paper.latest.join("\n") === mine.latest.join("\n");
      });
  }

  toDOM(view: EditorView): HTMLElement {
    const label = formatNoteCount(this.count);
    const button = document.createElement("button");
    button.className = "ls-note-marker";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    const count = document.createElement("span");
    count.textContent = String(this.count);
    button.innerHTML = renderIcon("note");
    button.append(count);
    // A button opens on click and on Enter or Space by itself.
    button.addEventListener("click", () => openPopover(view, button, this.papers, this.openNotes));
    return button;
  }
}

const setNoteSites = StateEffect.define<readonly NoteSite[]>();

function buildMarkers(sites: readonly NoteSite[], doc: Text, openNotes: NoteGutterOptions["openNotes"]): RangeSet<NoteMarker> {
  const ranges = [];
  for (const [line, papers] of groupByLine(sites)) {
    if (line < 0 || line + 1 > doc.lines) continue;
    ranges.push(new NoteMarker(papers, openNotes).range(doc.line(line + 1).from));
  }
  return RangeSet.of(ranges, true);
}

/** The look of the gutter markers and the popover. */
const noteTheme = EditorView.theme({
  ".ls-note-marker": {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--ls-space-1)", width: "100%", padding: "0 var(--ls-space-2)",
    border: "none", background: "none", color: "var(--ls-mark-accent)", cursor: "pointer", fontSize: "var(--ls-text-sm)",
  },
  ".ls-note-marker svg": { width: "var(--ls-space-6)", height: "var(--ls-space-6)" },
  ".ls-note-marker:focus-visible": { outline: "thin solid var(--ls-focus)" },
  ".ls-note-popover": {
    position: "fixed", zIndex: "100", maxWidth: "min(32em, 90vw)", maxHeight: "50vh", overflowY: "auto", boxSizing: "border-box",
    padding: "var(--ls-space-3)", backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)",
    borderRadius: "var(--ls-radius)", boxShadow: "var(--ls-widget-shadow)", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)",
  },
  ".ls-note-popover:focus": { outline: "none" },
  ".ls-note-popover-paper + .ls-note-popover-paper": { marginTop: "var(--ls-space-3)" },
  ".ls-note-popover-key": { fontWeight: "bold", color: "var(--ls-fg)" },
  ".ls-note-popover ul": { margin: "var(--ls-space-2) 0", paddingLeft: "var(--ls-space-6)" },
  ".ls-note-popover li": { color: "var(--ls-desc)", overflowWrap: "anywhere" },
});

export function createNoteGutter({ openNotes }: NoteGutterOptions = {}): NoteGutter {
  const markers = StateField.define<RangeSet<NoteMarker>>({
    create: () => RangeSet.empty,
    update(value, transaction) {
      let next = transaction.docChanged ? value.map(transaction.changes) : value;
      for (const effect of transaction.effects) {
        if (effect.is(setNoteSites)) next = buildMarkers(effect.value, transaction.newDoc, openNotes);
      }
      return next;
    },
  });
  const noteGutter = gutter({ class: "ls-note-gutter", markers: (view) => view.state.field(markers) });
  return {
    extension: [markers, noteGutter, noteTheme],
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

/** The notes of a paper as the gutter shows them: how many items, and the first lines of the last ones. */
function summarizeNotes(file: ItemFile): { notes: number; latest: string[] } {
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
  /** Without it no counts are loaded and the gutter stays empty. */
  notes?: NoteSitesDeps["notes"] | undefined;
  view(): EditorView | undefined;
  text(): string;
}

/** Loads the gutter's sites when asked: when the file opens and after each save, never per keystroke. A later request wins over an earlier one still reading. */
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
