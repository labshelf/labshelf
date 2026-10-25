/** Tracks the selection set and the visual-mode range it grows or shrinks around an anchor. */
import type { App } from "../app.js";

export class SelectionState {
  visualAnchor: number | undefined;
  visualBase = new Set<string>();

  constructor(private readonly app: App) {}

  toggleSelect(): void {
    const app = this.app;
    if (app.focus !== "papers") { return; }
    const paper = app.listModel.hoveredPaper();
    if (!paper) { return; }
    const id = paper.record.id;
    if (app.selection.has(id)) { app.selection.delete(id); } else { app.selection.add(id); }
    app.listModel.move(1);
  }

  toggleVisual(): void {
    const app = this.app;
    if (this.visualAnchor !== undefined) { return this.exitVisual(); }
    if (app.focus !== "papers") { return; }
    const index = app.listModel.cursor();
    if (index < 0) { return; }
    this.visualAnchor = index;
    this.visualBase = new Set(app.selection);
    this.applyVisual();
  }

  applyVisual(): void {
    if (this.visualAnchor === undefined) { return; }
    const app = this.app;
    const papers = app.listModel.papers();
    const index = app.listModel.cursorState().index;
    const [from, to] = this.visualAnchor <= index ? [this.visualAnchor, index] : [index, this.visualAnchor];
    app.selection = new Set(this.visualBase);
    for (let i = from; i <= to; i++) {
      const paper = papers[i];
      if (paper) { app.selection.add(paper.record.id); }
    }
  }

  exitVisual(): void {
    this.visualAnchor = undefined;
    this.visualBase = new Set();
  }
}
