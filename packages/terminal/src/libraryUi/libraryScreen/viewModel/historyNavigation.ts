/** Tracks back/forward folder history, the search's origin folder, and the jumps that make an entry into it. */
import type { Place } from "../screenModel.js";
import type { App } from "../app.js";

export class HistoryNav {
  searchOrigin: Place | undefined;
  private back: Place[] = [];
  private forward: Place[] = [];

  constructor(private readonly app: App) {}

  remember(): void {
    this.back.push({ folder: this.app.folder, search: this.app.search });
    if (this.back.length > 100) { this.back.shift(); }
    this.forward = [];
  }

  jumpToFolder(key: string): void {
    this.remember();
    this.app.listModel.setFolder(key);
    this.app.focus = "papers";
  }

  revealPaper(id: string): void {
    const app = this.app;
    const paper = app.ctx.store.paper(id);
    if (!paper) { return; }
    this.remember();
    app.listModel.setFolder(paper.collection);
    app.flatten = false;
    app.focus = "papers";
    app.listModel.cursorState().id = id;
  }

  /** Pushes the folder the current search started from onto the back stack, once the search is kept with Enter. */
  confirmSearch(): void {
    if (!this.searchOrigin) { return; }
    this.back.push(this.searchOrigin);
    this.forward = [];
  }

  leaveSearch(): void {
    const app = this.app;
    const origin = this.searchOrigin;
    this.searchOrigin = undefined;
    app.search = undefined;
    app.filter = "";
    if (origin) { app.folder = origin.folder; }
  }

  historyStep(direction: "back" | "forward"): void {
    const app = this.app;
    const from = direction === "back" ? this.back : this.forward;
    const to = direction === "back" ? this.forward : this.back;
    const target = from.pop();
    if (!target) { return; }
    to.push({ folder: app.folder, search: app.search });
    app.folder = target.folder;
    app.search = target.search;
    app.filter = "";
    app.selectionState.exitVisual();
  }
}
