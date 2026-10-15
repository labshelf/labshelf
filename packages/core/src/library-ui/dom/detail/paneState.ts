/**
 * Holds the detail pane's own state (open tab, citation style, folded sections, what is expanded or filtered) and
 * the bundle of data one paper's views render from.
 */
import { PAPERS_DIR } from "../../../library/index.js";
import type { AnnotationColor, PaperRecord } from "../../../model/index.js";
import { listPapersUnder, type ListPaper } from "../../derive/index.js";
import type { PaperDetails, PaperStats, SimilarPaper, TextLayerJobView } from "../../protocol/index.js";
import type { CiteFormat, DetailTab } from "../../state/index.js";
import type { UiContext } from "../uiContext.js";
import type { NoteEditor } from "./noteEditor.js";

export interface PaneState {
  ctx: UiContext;
  el: HTMLElement;
  tab: DetailTab;
  citeFormat: CiteFormat;
  collapsed: Record<string, boolean>;
  abstractOpen: boolean;
  authorsOpen: boolean;
  annFilter: string;
  annColor: AnnotationColor | null;
  /** The selection the pane shows, as sorted ids. */
  key: string;
  /** A render was skipped while the note had focus. */
  stale: boolean;
  notes: NoteEditor;
}

/** Everything a single paper's views read. */
export interface PaperView {
  p: ListPaper;
  stats: PaperStats | undefined;
  details: PaperDetails | undefined;
  job: TextLayerJobView | undefined;
  /** undefined: not asked; null: the host is searching. */
  similar: SimilarPaper[] | null | undefined;
  library: PaperRecord[];
  openFolder: string;
  pdfBusy: boolean;
}

export function paperView(ctx: UiContext, id: string): PaperView | null {
  const s = ctx.store.get();
  const p = listPapersUnder(s.papers, PAPERS_DIR, s.pdfDirs).find((q) => q.id === id);
  if (!p) return null;
  return {
    p, stats: s.stats[id], details: s.details[id], job: s.jobs[id], similar: s.similar[id], library: s.papers,
    openFolder: s.folder, pdfBusy: s.pdfBusy.has(id),
  };
}

/** The tab to show: a tab whose data the host cannot give falls back to Details. */
export function shownTab(pane: PaneState): DetailTab {
  return pane.tab === "annotations" && !pane.ctx.caps.paperData ? "details" : pane.tab;
}
