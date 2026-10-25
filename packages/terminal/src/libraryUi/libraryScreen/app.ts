// Runs the TUI: folders, papers, writing and preview panes driven by the keymap over the library the VS Code extension uses.
// Holds UI state only; library changes go through TerminalPaperService, .
import type { PaperData, PaperEntry } from "@labshelf/core";

import type { SortKey } from "../../config.js";
import type { AppContext } from "../../compositionRoot.js";
import { clearImages, drawImage, type CellRect } from "../../screen/index.js";
import type { InputEvent } from "../../screen/index.js";
import type { Screen } from "../../screen/index.js";
import type { TerminalSize } from "../../screen/index.js";
import type { InlineInput, Overlay } from "../overlays.js";
import { frame } from "./view/index.js";
import { handleInline, handleKey, handleMouse, handleOverlay } from "./input/index.js";
import { HistoryNav, ListModel, SelectionState, TaskStatus, WritingModel, computeAppLayout, type AppLayout } from "./viewModel/index.js";
import { ALL, type FolderRow, type Focus, type ImagePlan, type Message, type TerminalLike } from "./screenModel.js";

export type { TerminalLike };

export class App {
  focus: Focus = "papers";
  folder = ALL;
  search: string | undefined;
  flatten = false;
  sort: { key: SortKey; reverse: boolean };
  filter = "";
  selection = new Set<string>();
  cut: string[] | undefined;
  overlay: Overlay | undefined;
  inline: InlineInput | undefined;
  previewTab = 0;
  previewScroll = 0;
  pending: string[] = [];
  message: Message | undefined;
  readonly tasks = new Map<string, string>();

  // Bottom-line inline editing (f, / and s): the filter value to restore on Esc, and the live find query.
  filterBeforeEdit = "";
  findQuery = "";

  // Preview-pane sidecar cache: loaded lazily, one request in flight per paper id.
  readonly sidecars = new Map<string, PaperData>();
  readonly sidecarLoading = new Set<string>();

  image: { key: string; rect: CellRect } | undefined;
  size: TerminalSize;
  private renderQueued = false;
  private resolveQuit: (() => void) | undefined;

  readonly listModel: ListModel;
  readonly historyNav: HistoryNav;
  readonly selectionState: SelectionState;
  readonly taskStatus: TaskStatus;
  readonly writing: WritingModel;

  constructor(readonly ctx: AppContext, readonly term: TerminalLike, options: { now?: () => number } = {}) {
    this.size = term.size();
    const prefs = ctx.config.terminal ?? {};
    this.sort = { key: prefs.sort ?? "title", reverse: prefs.sortReverse ?? false };
    this.listModel = new ListModel(this);
    this.historyNav = new HistoryNav(this);
    this.selectionState = new SelectionState(this);
    this.taskStatus = new TaskStatus(this, options.now ?? Date.now);
    this.writing = new WritingModel(this);
    void this.writing.load();
    ctx.onRootLost(() => this.taskStatus.notify("Library folder not found", "warn"));
    ctx.conflicts.onChange(() => this.scheduleRender());
    ctx.store.onChange(() => {
      this.listModel.invalidateCaches();
      this.sidecars.clear();
      this.listModel.dropStale();
      void this.writing.load();
      this.scheduleRender();
    });
  }

  get layout(): AppLayout {
    return computeAppLayout(this.size.cols, this.size.rows, this.focus);
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /**
   * Takes over the terminal and runs until the user quits.
   * @returns when the user quit
   */
  run(): Promise<void> {
    this.term.listen((event) => this.handle(event), (size) => this.resize(size));
    this.term.enter();
    this.render();
    return new Promise((resolve) => { this.resolveQuit = resolve; });
  }

  async quit(): Promise<void> {
    if (this.image) { this.term.writeRaw(clearImages(this.ctx.imageProtocol)); }
    await this.ctx.dispose();
    this.term.leave();
    this.resolveQuit?.();
  }

  private resize(size: TerminalSize): void {
    this.size = size;
    this.image = undefined;
    this.term.writeRaw(clearImages(this.ctx.imageProtocol));
    this.render();
  }

  /** Coalesces render requests from async work into one frame. */
  scheduleRender(): void {
    if (this.renderQueued) { return; }
    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render(): void {
    const { screen, image } = this.frame();
    let extra = "";
    const protocol = this.ctx.imageProtocol;
    const sameImage = image && this.image && this.image.key === image.key
      && this.image.rect.x === image.rect.x && this.image.rect.y === image.rect.y
      && this.image.rect.cols === image.rect.cols && this.image.rect.rows === image.rect.rows;
    if (!sameImage) {
      if (this.image) {
        // kitty images sit on their own layer and are deleted; iTerm2 images are cell content, so repaint every cell.
        if (protocol === "kitty") { extra += clearImages(protocol); } else { this.term.invalidate(); }
      }
      if (image) { extra += drawImage(protocol, image.png, image.rect) + "\x1b[H"; }
      this.image = image ? { key: image.key, rect: image.rect } : undefined;
    }
    this.term.draw(screen, extra);
  }

  // ───────────────────────────── model ─────────────────────────────

  /** Rows of the folders pane: All papers, Unfiled, then the folder tree. */
  folderRows(): FolderRow[] {
    return this.listModel.folderRows();
  }

  /** Papers of the current source (the hovered folder, or the search results), sorted and filtered. */
  papers(): PaperEntry[] {
    return this.listModel.papers();
  }

  /** @returns the hovered paper of the papers pane */
  hoveredPaper(): PaperEntry | undefined {
    return this.listModel.hoveredPaper();
  }

  // ───────────────────────────── input ─────────────────────────────

  /**
   * Handles one input event (keys, paste, mouse).
   */
  handle(event: InputEvent): void {
    try {
      if (event.type === "mouse") {
        handleMouse(this, event);
      } else if (this.overlay) {
        handleOverlay(this, event);
      } else if (this.inline) {
        handleInline(this, event);
      } else if (event.type === "key") {
        handleKey(this, event.id);
      }
    } catch (error) {
      this.taskStatus.fail(error);
    }
    this.render();
  }

  // ───────────────────────────── drawing ─────────────────────────────

  /**
   * Builds the next frame.
   * @returns the screen and the thumbnail to draw over it, if any
   */
  frame(): { screen: Screen; image: ImagePlan | undefined } {
    return frame(this);
  }
}
