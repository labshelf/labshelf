/** Computes what is shown: the hovered folder or search, flattening, filtering and sorting, and the papers and folders it yields. */
import type { PaperEntry } from "@labshelf/core";

import { ALL, parentFolder, type FolderRow, type PaperCursor } from "../types.js";
import type { App } from "../app.js";

export class ListModel {
  folderOffset = 0;
  private papersCache: { key: string; papers: PaperEntry[] } | undefined;
  private foldersCache: { key: number; rows: FolderRow[] } | undefined;
  private readonly cursors = new Map<string, PaperCursor>();

  constructor(private readonly app: App) {}

  /** Drops the cached papers and folder rows after a library change; the next read recomputes them. */
  invalidateCaches(): void {
    this.papersCache = undefined;
    this.foldersCache = undefined;
  }

  /**
   * Rows of the folders pane: All papers, Unfiled (when the library root holds papers), then the folder tree.
   * @returns the rows
   */
  folderRows(): FolderRow[] {
    const snapshot = this.app.ctx.store.snapshot;
    if (this.foldersCache?.key === snapshot.scannedAt) { return this.foldersCache.rows; }
    const root = snapshot.collections.get("");
    const rows: FolderRow[] = [{ key: ALL, label: "All papers", depth: 0, count: snapshot.papers.size, pseudo: true }];
    if (root?.paperIds.length) { rows.push({ key: "", label: "Unfiled", depth: 0, count: root.paperIds.length, pseudo: true }); }
    const walk = (rels: string[], depth: number): void => {
      for (const rel of rels) {
        const node = snapshot.collections.get(rel);
        if (!node) { continue; }
        rows.push({ key: rel, label: node.name, depth, count: node.total });
        walk(node.children, depth + 1);
      }
    };
    walk(root?.children ?? [], 0);
    this.foldersCache = { key: snapshot.scannedAt, rows };
    return rows;
  }

  folderIndex(): number {
    const index = this.folderRows().findIndex((row) => row.key === this.app.folder);
    return index >= 0 ? index : 0;
  }

  private sourceKey(): string {
    const app = this.app;
    return app.search !== undefined ? `search\0${app.search}` : `folder\0${app.folder}\0${app.folder === ALL || app.flatten}`;
  }

  /**
   * Papers of the current source (the hovered folder, or the search results), sorted and filtered.
   * @returns the papers
   */
  papers(): PaperEntry[] {
    const app = this.app;
    const key = `${this.sourceKey()}\0${app.sort.key}${app.sort.reverse}\0${app.filter}\0${app.ctx.store.snapshot.scannedAt}`;
    if (this.papersCache?.key === key) { return this.papersCache.papers; }
    let papers: PaperEntry[];
    if (app.search !== undefined) {
      papers = app.ctx.store.search(app.search, app.sort);
      if (app.filter) { papers = papers.filter(app.ctx.store.matcher(app.filter)); }
    } else {
      const rel = app.folder === ALL ? "" : app.folder;
      papers = app.ctx.store.listCollection(rel, { sort: app.sort, flatten: app.folder === ALL || app.flatten, filter: app.filter })
        .flatMap((e) => (e.kind === "paper" ? [e.paper] : []));
    }
    this.papersCache = { key, papers };
    return papers;
  }

  cursorState(): PaperCursor {
    const key = this.sourceKey();
    let state = this.cursors.get(key);
    if (!state) {
      state = { id: undefined, index: 0, offset: 0 };
      this.cursors.set(key, state);
    }
    return state;
  }

  /**
   * Index of the hovered paper; follows the paper when the list changes underneath (sort, VS Code).
   * @returns the index, -1 for an empty list
   */
  cursor(): number {
    const papers = this.papers();
    const state = this.cursorState();
    if (!papers.length) { return -1; }
    if (state.id) {
      const found = papers.findIndex((p) => p.record.id === state.id);
      if (found >= 0) {
        state.index = found;
        return found;
      }
    }
    state.index = Math.max(0, Math.min(state.index, papers.length - 1));
    state.id = papers[state.index]!.record.id;
    return state.index;
  }

  /** @returns the hovered paper of the papers pane */
  hoveredPaper(): PaperEntry | undefined {
    const index = this.cursor();
    return index >= 0 ? this.papers()[index] : undefined;
  }

  setPaperCursor(index: number): void {
    const papers = this.papers();
    if (!papers.length) { return; }
    const state = this.cursorState();
    const clamped = Math.max(0, Math.min(index, papers.length - 1));
    if (state.id !== papers[clamped]!.record.id) { this.app.previewScroll = 0; }
    state.index = clamped;
    state.id = papers[clamped]!.record.id;
    if (this.app.selectionState.visualAnchor !== undefined) { this.app.selectionState.applyVisual(); }
  }

  setFolder(key: string): void {
    const app = this.app;
    if (key === app.folder && app.search === undefined) { return; }
    app.folder = key;
    app.search = undefined;
    app.filter = "";
    app.previewScroll = 0;
    app.selectionState.exitVisual();
  }

  move(delta: number): void {
    const app = this.app;
    if (app.focus === "folders") {
      const rows = this.folderRows();
      const next = rows[Math.max(0, Math.min(this.folderIndex() + delta, rows.length - 1))];
      if (next) { this.setFolder(next.key); }
      return;
    }
    const index = this.cursor();
    if (index >= 0) { this.setPaperCursor(index + delta); }
  }

  moveTo(position: "top" | "bottom"): void {
    if (this.app.focus === "folders") {
      const rows = this.folderRows();
      const row = position === "top" ? rows[0] : rows[rows.length - 1];
      if (row) { this.setFolder(row.key); }
      return;
    }
    this.setPaperCursor(position === "top" ? 0 : this.papers().length - 1);
  }

  // Papers the next action applies to: the selection, or the hovered paper while the papers pane has focus.
  targetPapers(): PaperEntry[] {
    const app = this.app;
    if (app.selection.size) {
      return [...app.selection].map((id) => app.ctx.store.paper(id)).filter((p): p is PaperEntry => Boolean(p));
    }
    if (app.focus !== "papers") { return []; }
    const hovered = this.hoveredPaper();
    return hovered ? [hovered] : [];
  }

  hoveredFolderRel(): string | undefined {
    return this.app.focus === "folders" && this.app.folder !== ALL ? this.app.folder : undefined;
  }

  dropStale(): void {
    const app = this.app;
    for (const id of [...app.selection]) { if (!app.ctx.store.paper(id)) { app.selection.delete(id); } }
    if (app.cut) {
      app.cut = app.cut.filter((key) => (key.startsWith("p:") ? app.ctx.store.paper(key.slice(2)) : app.ctx.store.collection(key.slice(2))));
      if (!app.cut.length) { app.cut = undefined; }
    }
    if (app.folder !== ALL && !app.ctx.store.collection(app.folder)) {
      // Renamed or removed elsewhere: fall back to the nearest folder that still exists.
      let rel: string = app.folder;
      while (rel !== ALL && !app.ctx.store.collection(rel)) { rel = parentFolder(rel); }
      app.folder = rel;
    }
    if (app.folder === "" && !app.ctx.store.collection("")?.paperIds.length) { app.folder = ALL; }
  }
}
