/**
 * Holds the reactive store behind the library UI. Views subscribe to slices with {@link LibraryViewStore.select} and repaint
 * only when their slice changes; the host's snapshots go through {@link LibraryViewStore.applySnapshot}.
 */
import { editedTags } from "../../library/index.js";
import type { PaperRecord, PaperStatus } from "../../model/index.js";
import type { CitationMapState, LibraryUiSnapshot, PaperDetails, PaperFilesState, SimilarPaper, TextLayerJobView } from "../protocol/index.js";
import { shallowEqual } from "./shallowEqual.js";
import { mergeSnapshot } from "./snapshotIdentity.js";
import { INITIAL_VIEW_STATE, type LibraryViewState } from "./viewState.js";

type Listener<T> = (value: T) => void;
type Selector<T> = (state: LibraryViewState) => T;

export class LibraryViewStore {
  private state: LibraryViewState;
  private readonly listeners = new Set<{ select: Selector<unknown>; cb: Listener<unknown>; prev: unknown }>();

  constructor(initial: Partial<LibraryViewState> = {}) {
    this.state = { ...INITIAL_VIEW_STATE, ...initial };
  }

  /** Returns a shallow copy so callers cannot mutate internal state. */
  get(): LibraryViewState { return { ...this.state }; }

  /** Merges a partial update into state and notifies subscribers whose slice changed. */
  set(patch: Partial<LibraryViewState>): void {
    this.state = { ...this.state, ...patch };
    for (const entry of this.listeners) {
      const next = entry.select(this.state);
      if (!shallowEqual(next, entry.prev)) {
        entry.prev = next;
        entry.cb(next);
      }
    }
  }

  /** Subscribes to a slice and calls the listener at once with its current value. Returns the unsubscribe function. */
  select<T>(selector: Selector<T>, listener: Listener<T>): () => void {
    const initial = selector(this.state);
    const entry = { select: selector as Selector<unknown>, cb: listener as Listener<unknown>, prev: initial as unknown };
    this.listeners.add(entry);
    listener(initial);
    return () => { this.listeners.delete(entry); };
  }

  /** Takes in a host snapshot; records equal to the ones held keep their identity. */
  applySnapshot(snapshot: LibraryUiSnapshot): void {
    this.set({ ...mergeSnapshot(this.state, snapshot), loading: false });
  }

  /** Shows a status change at once, before the host confirms it with the next snapshot. */
  applyStatus(ids: readonly string[], status: PaperStatus): void {
    this.patchPapers(ids, (p) => (p.status === status ? p : { ...p, status }));
  }

  /** Shows a tag edit at once, before the host confirms it with the next snapshot. */
  applyTags(ids: readonly string[], add: readonly string[], remove: readonly string[]): void {
    this.patchPapers(ids, (p) => {
      const tags = editedTags(p.tags ?? [], add, remove);
      return tags.join("\n") === (p.tags ?? []).join("\n") ? p : { ...p, tags };
    });
  }

  /** Shows a saved note at once, before the host confirms it with the next snapshot. */
  applyNote(id: string, note: string): void {
    this.patchPapers([id], (p) => ((p.note ?? "") === note ? p : { ...p, note }));
  }

  /** Replaces the OCR jobs with the host's list. */
  setJobs(jobs: readonly TextLayerJobView[]): void {
    this.set({ jobs: Object.fromEntries(jobs.map((j) => [j.paperId, j])) });
  }

  /** Shows papers as queued for OCR at once, before the host reports its jobs. */
  queueJobs(ids: readonly string[]): void {
    const queued = ids.filter((id) => !this.state.jobs[id]).map((paperId): [string, TextLayerJobView] => [paperId, { paperId, phase: "queued" }]);
    if (queued.length) this.set({ jobs: { ...this.state.jobs, ...Object.fromEntries(queued) } });
  }

  /** Keeps what the host sent about one paper. */
  setDetails(id: string, details: PaperDetails): void {
    this.set({ details: { ...this.state.details, [id]: details } });
  }

  /** Keeps a paper's similar papers; null marks a search in flight. */
  setSimilar(id: string, items: SimilarPaper[] | null): void {
    this.set({ similar: { ...this.state.similar, [id]: items } });
  }

  /** Marks a paper's PDF search as running or done. */
  setPdfBusy(id: string, busy: boolean): void {
    const next = new Set(this.state.pdfBusy);
    if (busy) next.add(id); else next.delete(id);
    this.set({ pdfBusy: next });
  }

  /** Selects exactly one paper and makes it the anchor and cursor. */
  selectOnly(id: string): void {
    this.set({ selected: new Set([id]), anchor: id, cursor: id });
  }

  /** Toggles one paper in the selection (Cmd/Ctrl-click). */
  toggleSelected(id: string): void {
    const next = new Set(this.state.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.set({ selected: next, anchor: id, cursor: id });
  }

  /** Selects the run of `order` between the anchor and `toId` (Shift-click / Shift-arrow). */
  selectRange(order: readonly string[], toId: string): void {
    const a = this.state.anchor ? order.indexOf(this.state.anchor) : -1;
    const b = order.indexOf(toId);
    if (a === -1 || b === -1) { this.selectOnly(toId); return; }
    this.set({ selected: new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)), cursor: toId });
  }

  /** Clears the selection, anchor and cursor. */
  clearSelection(): void {
    if (this.state.selected.size === 0 && !this.state.cursor) return;
    this.set({ selected: new Set(), anchor: null, cursor: null });
  }

  /** Shows the files of a paper and closes the one open before; null closes them. Opening a paper marks its files as loading. */
  openPaper(id: string | null): void {
    if (id === this.state.open) return;
    if (id === null) { this.set({ open: null }); return; }
    this.set({ open: id, files: { ...this.state.files, [id]: { status: "loading" } } });
  }

  /** Keeps the file listing the host sent for a paper. */
  setFiles(id: string, state: PaperFilesState): void {
    this.set({ files: { ...this.state.files, [id]: state } });
  }

  /** Opens a folder and resets the search, the status tab, the No text filter and the selection; closes the citation map. */
  openFolder(path: string): void {
    if (path === this.state.folder) {
      if (this.state.citationMap) this.set({ citationMap: null });
      return;
    }
    this.set({ folder: path, query: "", status: "all", noText: false, selected: new Set(), anchor: null, cursor: null, citationMap: null });
  }

  /** Shows the citation map in place of the paper list; null goes back to the paper list. */
  showCitationMap(state: CitationMapState | null): void {
    this.set({ citationMap: state, citationImporting: new Set() });
  }

  /** Marks a missing work's import as running or done. */
  setCitationImporting(workId: string, busy: boolean): void {
    const next = new Set(this.state.citationImporting);
    if (busy) next.add(workId); else next.delete(workId);
    this.set({ citationImporting: next });
  }

  /** Drops an imported work from the citation map. */
  removeMissingWork(workId: string): void {
    const shown = this.state.citationMap;
    const importing = new Set(this.state.citationImporting);
    importing.delete(workId);
    if (shown?.status !== "ready") { this.set({ citationImporting: importing }); return; }
    const map = { ...shown.map, missing: shown.map.missing.filter((w) => w.workId !== workId) };
    this.set({ citationMap: { status: "ready", map }, citationImporting: importing });
  }

  private patchPapers(ids: readonly string[], change: (p: PaperRecord) => PaperRecord): void {
    const wanted = new Set(ids);
    const papers = this.state.papers.map((p) => (wanted.has(p.id) ? change(p) : p));
    if (papers.some((p, i) => p !== this.state.papers[i])) this.set({ papers });
  }
}
