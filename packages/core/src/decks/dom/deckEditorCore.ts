// The deck editor's state and the operations on it: laying out the stage, showing a deck, committing edits to history and the host,
// undo and redo, selection, slides and in-place text editing. deckEditorInput.ts turns pointer and key events into these operations.
import { applyDeckEdit, type DeckEdit, type DeckEditResult } from "../deckEdit.js";
import { parseDeck, type DeckBlock, type DeckModel, type DeckRect } from "../deckParse.js";
import type { DeckLinkSources } from "../deckLinks.js";
import { deckCanvasPx } from "../deckSizes.js";
import { validateDeck, type DeckDiagnostic } from "../deckValidate.js";
import type { DeckSelection } from "../deckGestures.js";
import type { DeckGrid } from "../deckGrid.js";
import type { DeckGroupGesture } from "../deckGroupGesture.js";
import type { DeckSnapResult } from "../deckSnap.js";
import type { DeckHistory } from "../deckHistory.js";
import type { DeckFrame, DeckMathLoader } from "./deckFrame.js";
import type { DeckOverlay, LinkBadgeSync } from "./deckOverlay.js";
import { createLeafEditing, type LeafEditing } from "./leafEditing.js";
import { leafLinkHref, setLeafColor, setLeafLink, toggleLeafMark, type LeafMark } from "./leafFormat.js";
import type { DeckSourceToggle } from "./deckSourceView.js";

export type DeckHistoryMode = "internal" | "host";
export interface DeckEditorChange { html: string; theme: string; label: string }
/** The editor draws only the stage, in a scrolling viewport with zoom; the deck shell (shell/html/) brings the toolbars, panels and status. */
export interface DeckEditorOptions { html: string; theme: string; resolveAsset(path: string): Promise<string>; loadMath?: DeckMathLoader; assetOrigin?: string; linkSources?: DeckLinkSources; history?: DeckHistoryMode; onChange(change: DeckEditorChange): void; onUndo?: () => void; onRedo?: () => void; onRender?(view: DeckEditorView): void }
/** What the editor shows after each redraw, for the panels around it; `fit` is whether the zoom fits the slide; `errors` are the read-only deck's problems as lines. */
export interface DeckEditorView { html: string; theme: string; model: DeckModel | undefined; slide: number; blocks: readonly string[]; readOnly: boolean; scale: number; fit: boolean; notice: string; canUndo: boolean; canRedo: boolean; errors: string[] }
export interface DeckEditorController {
  readonly element: HTMLElement; readonly stage: HTMLElement; readonly viewport: HTMLElement;
  setDocument(html: string, theme: string): void; selectSlide(index: number): void; currentSlide(): number; undo(): void; redo(): void; destroy(): void;
  edit(steps: Array<(html: string) => DeckEditResult>, label: string): void;
  selectBlocks(ids: readonly string[]): void; editText(block: string): void;
  /** Replaces theme.css with `css` as one undo step labelled `label`. */
  editThemeCss(css: string, label: string): void;
  /** Renders the frame with `css` as its theme without touching the deck, history or change events; null shows the real theme again. Any change clears it. */
  previewThemeCss(css: string | null): void;
  setZoom(zoom: number | "fit"): void; setTool(tool: "select" | "hand"): void; toggleSource(): boolean;
  /** Formatting of the open leaf's selection, or null when no leaf without math is open. */
  leafFormatting(): DeckLeafFormatting | null;
  /** Calls `listener` on Mod+K in an open leaf; returns the unsubscribe. */
  onLinkRequest(listener: () => void): () => void;
}
/** Formatting of the selection inside the open leaf; each change stays in the leaf until it commits as one 'Edit text'. */
export interface DeckLeafFormatting {
  /** Whether the selection is non-collapsed and wholly inside the leaf. */
  hasSelection(): boolean;
  mark(mark: LeafMark): boolean;
  color(color: string | null): boolean;
  /** Links the selection (kept from `hold(true)` when a link input took the focus); null removes the link. */
  link(href: string | null): boolean;
  /** The href of the link at the selection, or "". */
  linkHref(): string;
  /** Keeps the leaf open and its selection while a link input of the host has the focus. */
  hold(on: boolean): void;
  /** Gives the focus and the kept selection back to the leaf. */
  focus(): void;
}
const DEFAULT_CANVAS = { width: 1920, height: 1080 };
/** The space a fitted slide keeps around it in the viewport, in screen px. */
const FIT_MARGIN = 32;

/** A drag of the selection: the group gesture over its members, the snap targets and grid, and the last snapped result. */
export interface Drag { gesture: DeckGroupGesture; others: DeckRect[]; grid: DeckGrid; result: DeckSnapResult | null }
/** A marquee drawn from a stage press: its origin in client px, whether Shift adds, and its rect in slide px once it moved 3 screen px. */
interface Marquee { origin: { x: number; y: number }; stage: { left: number; top: number }; add: boolean; rect: DeckRect | null }

export interface Editor {
  options: DeckEditorOptions;
  html: string;
  theme: string;
  model: DeckModel | undefined;
  errors: DeckDiagnostic[];
  selection: DeckSelection;
  history: DeckHistory | null;
  drag: Drag | null;
  marquee?: Marquee | null;
  leaf: LeafEditing;
  /** Listeners of Mod+K in an open leaf. */
  linkListeners?: Set<() => void>;
  frameSlide: number;
  /** The theme the frame shows in place of `theme` while a Style candidate is previewed. */
  previewTheme?: string | null;
  notice: string;
  scale: number;
  zoom: number | "fit";
  tool: "select" | "hand";
  destroyed: boolean;
  root: HTMLElement;
  stage: HTMLElement;
  /** The scrolling box around the stage. */
  viewport: HTMLElement;
  frame: DeckFrame;
  overlay: DeckOverlay;
  badges: LinkBadgeSync | null; // set when the host gives linkSources
  source: DeckSourceToggle;
}

export const isReadOnly = (ed: Editor): boolean => ed.errors.length > 0;
export const slideBlocks = (ed: Editor): DeckBlock[] => ed.model?.slides[ed.selection.slide]?.blocks ?? [];
export const canvasOf = (ed: Editor): { width: number; height: number } => (ed.model?.size ? deckCanvasPx(ed.model.size) : DEFAULT_CANVAS);
export const findBlock = (ed: Editor, id: string): DeckBlock | undefined => slideBlocks(ed).find((block) => block.id === id);
export const selectedBlocks = (ed: Editor): Array<DeckBlock & { rect: DeckRect }> =>
  slideBlocks(ed).filter((block): block is DeckBlock & { rect: DeckRect } => block.rect !== null && ed.selection.blocks.includes(block.id));

/** Lays out the stage (scale, frame size), redraws the overlay and hands the view to the host. */
export function renderChrome(ed: Editor): void {
  if (ed.destroyed) return;
  layoutStage(ed);
  const readOnly = isReadOnly(ed);
  const blocks = readOnly ? [] : slideBlocks(ed).flatMap((block) => (block.rect ? [{ id: block.id, rect: block.rect }] : []));
  ed.overlay.render(blocks, ed.selection.blocks, ed.leaf.block(), ed.scale);
  ed.root.classList.toggle("is-read-only", readOnly);
  ed.root.classList.toggle("is-editing", ed.leaf.block() !== null);
  ed.badges?.refresh(readOnly ? undefined : ed.model, ed.selection.slide);
  const host = ed.history === null;
  ed.options.onRender?.({
    html: ed.html, theme: ed.theme, model: ed.model, slide: ed.selection.slide, blocks: ed.selection.blocks, readOnly, scale: ed.scale, fit: ed.zoom === "fit", notice: ed.notice,
    canUndo: !readOnly && (host ? !!ed.options.onUndo : ed.history!.canUndo()), canRedo: !readOnly && (host ? !!ed.options.onRedo : ed.history!.canRedo()),
    errors: ed.errors.map((d) => `${d.code} line ${d.line}: ${d.message}`),
  });
}

/** Scales the frame to the zoom; fit shows the whole slide in the viewport. */
function layoutStage(ed: Editor): void {
  const canvas = canvasOf(ed);
  const fit = Math.min((ed.viewport.clientWidth - FIT_MARGIN * 2) / canvas.width, (ed.viewport.clientHeight - FIT_MARGIN * 2) / canvas.height);
  ed.scale = ed.zoom === "fit" ? (fit > 0 ? fit : 1) : ed.zoom;
  ed.stage.style.width = `${canvas.width * ed.scale}px`;
  ed.frame.frame.style.width = `${canvas.width}px`;
  ed.frame.frame.style.height = `${canvas.height}px`;
  ed.stage.style.setProperty("--deck-editor-scale", String(ed.scale));
  ed.stage.style.height = `${canvas.height * ed.scale}px`;
}

/** Makes (html, theme) the shown deck: re-parses, re-validates, re-renders the frame and keeps slide and selection where they still exist. */
export function show(ed: Editor, html: string, theme: string): void {
  ed.html = html;
  ed.theme = theme;
  ed.previewTheme = null;
  ed.model = parseDeck(html, { theme }).model;
  ed.errors = validateDeck(html, { theme }).filter((d) => d.severity === "error");
  ed.notice = "";
  const slides = ed.model?.slides.length ?? 0;
  const slide = Math.max(0, Math.min(ed.selection.slide, slides - 1));
  const ids = new Set(ed.model?.slides[slide]?.blocks.map((block) => block.id) ?? []);
  ed.selection = slide === ed.selection.slide ? { slide, blocks: ed.selection.blocks.filter((id) => ids.has(id)) } : { slide, blocks: [] };
  void ed.frame.update(html, theme);
  ed.source.sync(html);
  if (slide !== ed.frameSlide) void ed.frame.setSlide((ed.frameSlide = slide));
  renderChrome(ed);
}
export const commitEdits = (ed: Editor, edits: DeckEdit[], label: string, select?: number): void => commitSteps(ed, edits.map((edit) => (html: string) => applyDeckEdit(html, edit)), label, select);

/** One change from steps applied in order to the html (and an optional new theme): shown, pushed to history and handed to the host; a failing step shows its error. */
export function commitSteps(ed: Editor, steps: Array<(html: string) => DeckEditResult>, label: string, select?: number, theme = ed.theme): void {
  if (isReadOnly(ed) || (steps.length === 0 && theme === ed.theme)) return;
  let html = ed.html;
  for (const apply of steps) {
    const result = apply(html);
    if (!result.ok) return void ((ed.notice = result.error), renderChrome(ed));
    html = result.html;
  }
  if (html === ed.html && theme === ed.theme) return;
  if (select !== undefined) ed.selection = { slide: select, blocks: [] };
  record(ed, html, theme, label);
}

/** Shows (html, theme), pushes it to history and hands it to the host as one change; a source edit comes here even when the deck is read-only. */
export function record(ed: Editor, html: string, theme: string, label: string): void {
  ed.history?.push({ html, theme });
  show(ed, html, theme);
  ed.options.onChange({ html, theme, label });
}

/** A whole new theme.css as one history entry; the same theme records nothing. */
export function changeThemeCss(ed: Editor, css: string, label: string): void {
  commitEditing(ed);
  commitSteps(ed, [], label, undefined, css);
}

/** Renders the frame with `css` as its theme (null: the real theme) and leaves the deck, history and host alone. */
export function previewThemeCss(ed: Editor, css: string | null): void {
  if (ed.destroyed || css === (ed.previewTheme ?? null)) return;
  ed.previewTheme = css;
  void ed.frame.update(ed.html, css ?? ed.theme);
}

export function step(ed: Editor, direction: "undo" | "redo"): void {
  if (ed.destroyed) return;
  cancelEditing(ed);
  if (!ed.history) return void (direction === "undo" ? ed.options.onUndo?.() : ed.options.onRedo?.());
  const snapshot = direction === "undo" ? ed.history.undo() : ed.history.redo();
  if (!snapshot) return;
  show(ed, snapshot.html, snapshot.theme);
  ed.options.onChange({ html: snapshot.html, theme: snapshot.theme, label: direction === "undo" ? "Undo" : "Redo" });
}

export function setSelection(ed: Editor, selection: DeckSelection): void {
  ed.selection = selection;
  renderChrome(ed);
}

export function selectSlide(ed: Editor, index: number): void {
  const slides = ed.model?.slides.length ?? 0;
  if (slides === 0) return;
  const slide = Math.max(0, Math.min(Math.trunc(index), slides - 1));
  if (slide === ed.selection.slide) return;
  commitEditing(ed);
  ed.selection = { slide, blocks: [] };
  void ed.frame.setSlide((ed.frameSlide = slide));
  renderChrome(ed);
}

export function beginEditing(ed: Editor, block: string, target: Element | null): void {
  if (isReadOnly(ed) || ed.destroyed) return;
  commitEditing(ed);
  const model = findBlock(ed, block);
  if (!model) return;
  const leaves = ed.frame.leaves().filter((leaf) => leaf.block === block && !model.leaves[leaf.index]?.math);
  const leaf = (target ? leaves.find((candidate) => candidate.element.contains(target)) : undefined) ?? leaves[0];
  if (!leaf) return;
  ed.leaf.begin(leaf.element, block, leaf.index);
  setSelection(ed, { slide: ed.selection.slide, blocks: [block] });
}

export const commitEditing = (ed: Editor): void => ed.leaf.commit(); export const cancelEditing = (ed: Editor): void => ed.leaf.cancel();

/** The formatting of the open leaf's selection, or null when no leaf without math is open. */
export function leafFormatting(ed: Editor): DeckLeafFormatting | null {
  const element = ed.leaf.formattable();
  if (!element) return null;
  let kept: Range | null = null;
  const select = (): void => {
    if (!kept) return;
    const selection = element.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(kept);
  };
  return {
    hasSelection() {
      const selection = element.ownerDocument.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      return !!range && !range.collapsed && element.contains(range.startContainer) && element.contains(range.endContainer);
    },
    mark: (mark) => toggleLeafMark(element, mark),
    color: (color) => setLeafColor(element, color),
    link: (href) => (select(), setLeafLink(element, href)),
    linkHref: () => leafLinkHref(element),
    hold(on) {
      const selection = element.ownerDocument.getSelection();
      if (on && selection && selection.rangeCount > 0) kept = selection.getRangeAt(0).cloneRange();
      ed.leaf.hold(on);
    },
    focus() {
      element.focus({ preventScroll: true });
      select();
    },
  };
}

export function onLinkRequest(ed: Editor, listener: () => void): () => void {
  const listeners = (ed.linkListeners ??= new Set());
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function createLeaf(ed: () => Editor): LeafEditing {
  return createLeafEditing({
    commit: (block, leaf, text) => commitEdits(ed(), [{ kind: "setText", block, leaf, text }], "Edit text"),
    commitInline: (block, leaf, html) => commitEdits(ed(), [{ kind: "setInline", block, leaf, html }], "Edit text"),
    requestLink: () => { for (const listener of ed().linkListeners ?? []) listener(); },
    closed: () => renderChrome(ed()),
    doubleClick: (target) => {
      const block = target.closest("[data-block]")?.getAttribute("data-block");
      if (block) beginEditing(ed(), block, target);
    },
  });
}

