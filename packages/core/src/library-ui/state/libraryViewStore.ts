/**
 * Reactive store behind the library UI. Views subscribe to slices with {@link LibraryViewStore.select} and repaint
 * only when their slice changes; the host's snapshots go through {@link LibraryViewStore.applySnapshot}.
 */
import type { PaperStatus } from "../../model/index.js";
import type { LibraryUiSnapshot } from "../protocol/index.js";
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
    const wanted = new Set(ids);
    this.set({ papers: this.state.papers.map((p) => (wanted.has(p.id) && p.status !== status ? { ...p, status } : p)) });
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

  /** Opens a folder and resets the search, the status tab and the selection. */
  openFolder(path: string): void {
    if (path === this.state.folder) return;
    this.set({ folder: path, query: "", status: "all", selected: new Set(), anchor: null, cursor: null });
  }
}
