// The deck editor's state and the operations on it: drawing the chrome, showing a deck, committing edits to history and the host,
// undo and redo, selection, slides and in-place text editing. deckEditorInput.ts turns pointer and key events into these operations.
import { renderElement } from "../../ui/dom/index.js";
import { applyDeckEdit, type DeckEdit, type DeckEditResult } from "../deckEdit.js";
import { parseDeck, type DeckBlock, type DeckModel, type DeckRect } from "../deckParse.js";
import type { DeckLinkSources } from "../deckLinks.js";
import { deckCanvasPx } from "../deckSizes.js";
import { setThemeProperty } from "../themeCss.js";
import { validateDeck, type DeckDiagnostic } from "../deckValidate.js";
import type { DeckGesture, DeckSelection } from "../deckGestures.js";
import type { DeckHistory } from "../deckHistory.js";
import type { DeckFrame, DeckMathLoader } from "./deckFrame.js";
import type { DeckOverlay, LinkBadgeSync } from "./deckOverlay.js";
import { createLeafEditing, type LeafEditing } from "./leafEditing.js";
import type { DeckSourceToggle } from "./deckSourceView.js";
import { mountSlideStrip, type SlideStrip } from "./slideStrip.js";
import type { DeckThumbnails } from "./slideThumbnails.js";
import type { ToolbarPopover } from "./themePanel.js";

export type DeckHistoryMode = "internal" | "host";
export interface DeckEditorChange { html: string; theme: string; label: string }
/** `bare` draws only the stage, in a scrolling viewport with zoom, for a workspace that brings its own toolbar, panels and status. */
export interface DeckEditorOptions { html: string; theme: string; resolveAsset(path: string): Promise<string>; loadMath?: DeckMathLoader; assetOrigin?: string; linkSources?: DeckLinkSources; history?: DeckHistoryMode; bare?: boolean; onChange(change: DeckEditorChange): void; onUndo?: () => void; onRedo?: () => void; onRender?(view: DeckEditorView): void }
/** What the editor shows after each redraw, for the panels around it; `errors` are the read-only deck's problems as lines. */
export interface DeckEditorView { html: string; theme: string; model: DeckModel | undefined; slide: number; blocks: readonly string[]; readOnly: boolean; scale: number; notice: string; canUndo: boolean; canRedo: boolean; errors: string[] }
export interface DeckEditorController {
  readonly element: HTMLElement; readonly stage: HTMLElement; readonly viewport: HTMLElement;
  setDocument(html: string, theme: string): void; selectSlide(index: number): void; currentSlide(): number; undo(): void; redo(): void; destroy(): void;
  edit(steps: Array<(html: string) => DeckEditResult>, label: string): void;
  selectBlocks(ids: readonly string[]): void; editText(block: string): void; editTheme(name: string, value: string): void;
  setZoom(zoom: number | "fit"): void; setTool(tool: "select" | "hand"): void; toggleSource(): boolean;
}
const READ_ONLY_STATUS = "This deck has errors and opens read-only.";
const DEFAULT_CANVAS = { width: 1920, height: 1080 };
/** The space a fitted slide keeps around it in a bare editor's viewport, in screen px. */
const FIT_MARGIN = 32;

export interface Drag { gesture: DeckGesture; others: DeckRect[]; rect: DeckRect | null }

export interface Editor {
  options: DeckEditorOptions;
  html: string;
  theme: string;
  model: DeckModel | undefined;
  errors: DeckDiagnostic[];
  selection: DeckSelection;
  history: DeckHistory | null;
  drag: Drag | null;
  leaf: LeafEditing;
  frameSlide: number;
  notice: string;
  scale: number;
  zoom: number | "fit";
  tool: "select" | "hand";
  destroyed: boolean;
  root: HTMLElement;
  stage: HTMLElement;
  /** The scrolling box around the stage of a bare editor; the stage itself otherwise. */
  viewport: HTMLElement;
  body: HTMLElement;
  strip: SlideStrip | null;
  thumbnails: DeckThumbnails;
  frame: DeckFrame;
  overlay: DeckOverlay;
  buttons: { undo: HTMLButtonElement; redo: HTMLButtonElement; remove: HTMLButtonElement };
  popovers: ToolbarPopover[];
  badges: LinkBadgeSync | null; // set when the host gives linkSources
  source: DeckSourceToggle;
  status: HTMLElement;
  problems: HTMLElement;
}

export const isReadOnly = (ed: Editor): boolean => ed.errors.length > 0;
export const slideBlocks = (ed: Editor): DeckBlock[] => ed.model?.slides[ed.selection.slide]?.blocks ?? [];
export const canvasOf = (ed: Editor): { width: number; height: number } => (ed.model?.size ? deckCanvasPx(ed.model.size) : DEFAULT_CANVAS);
export const findBlock = (ed: Editor, id: string): DeckBlock | undefined => slideBlocks(ed).find((block) => block.id === id);
export const selectedBlocks = (ed: Editor): Array<DeckBlock & { rect: DeckRect }> =>
  slideBlocks(ed).filter((block): block is DeckBlock & { rect: DeckRect } => block.rect !== null && ed.selection.blocks.includes(block.id));

/** Lays out the stage (scale, frame size) and redraws the overlay, toolbar, status line and problems list. */
export function renderChrome(ed: Editor): void {
  if (ed.destroyed) return;
  layoutStage(ed);
  const readOnly = isReadOnly(ed);
  const blocks = readOnly ? [] : slideBlocks(ed).flatMap((block) => (block.rect ? [{ id: block.id, rect: block.rect }] : []));
  ed.overlay.render(blocks, ed.selection.blocks, ed.leaf.block(), ed.scale);
  ed.root.classList.toggle("is-read-only", readOnly);
  ed.root.classList.toggle("is-editing", ed.leaf.block() !== null);
  const host = ed.history === null;
  ed.buttons.undo.disabled = readOnly || (host ? !ed.options.onUndo : !ed.history!.canUndo());
  ed.buttons.redo.disabled = readOnly || (host ? !ed.options.onRedo : !ed.history!.canRedo());
  ed.buttons.remove.disabled = readOnly || selectedBlocks(ed).length === 0;
  for (const popover of ed.popovers) { popover.button.disabled = readOnly; if (readOnly) popover.close(); }
  ed.badges?.refresh(readOnly ? undefined : ed.model, ed.selection.slide);
  const slides = ed.model?.slides.length ?? 0;
  ed.status.textContent = ed.notice || (readOnly ? READ_ONLY_STATUS : slides > 0 ? `Slide ${ed.selection.slide + 1} of ${slides}` : "This deck has no slides.");
  ed.problems.replaceChildren(...ed.errors.map((d) => renderElement("li", { class: "deck-editor-problem", text: `${d.code} line ${d.line}: ${d.message}` })));
  ed.problems.hidden = !readOnly;
  if (!ed.options.bare) syncStrip(ed, slides);
  ed.options.onRender?.({
    html: ed.html, theme: ed.theme, model: ed.model, slide: ed.selection.slide, blocks: ed.selection.blocks, readOnly, scale: ed.scale, notice: ed.notice,
    canUndo: !ed.buttons.undo.disabled, canRedo: !ed.buttons.redo.disabled, errors: ed.errors.map((d) => `${d.code} line ${d.line}: ${d.message}`),
  });
}

/** Scales the frame: to the stage width, or for a bare editor to the zoom (fit shows the whole slide in the viewport). */
function layoutStage(ed: Editor): void {
  const canvas = canvasOf(ed);
  if (ed.options.bare) {
    const fit = Math.min((ed.viewport.clientWidth - FIT_MARGIN * 2) / canvas.width, (ed.viewport.clientHeight - FIT_MARGIN * 2) / canvas.height);
    ed.scale = ed.zoom === "fit" ? (fit > 0 ? fit : 1) : ed.zoom;
    ed.stage.style.width = `${canvas.width * ed.scale}px`;
  } else {
    const width = ed.stage.clientWidth;
    ed.scale = width > 0 ? width / canvas.width : 1;
  }
  ed.frame.frame.style.width = `${canvas.width}px`;
  ed.frame.frame.style.height = `${canvas.height}px`;
  ed.stage.style.setProperty("--deck-editor-scale", String(ed.scale));
  ed.stage.style.height = `${canvas.height * ed.scale}px`;
}

/** The strip shows for a talk that opens for editing; a poster has one slide. */
export function syncStrip(ed: Editor, slides: number): void {
  if (ed.model?.kind !== "talk" || isReadOnly(ed) || slides === 0) {
    ed.strip?.destroy();
    ed.strip = null;
    return;
  }
  if (ed.strip) return ed.strip.update(slides, ed.selection.slide);
  ed.strip = mountSlideStrip(ed.body, {
    count: slides,
    current: ed.selection.slide,
    thumbnail: (index) => ed.thumbnails.thumbnail(index),
    onSelect: (index) => selectSlide(ed, index),
    onEdit: (edit, label) => stripEdit(ed, edit, label),
    fallback: { size: () => canvasOf(ed), srcdoc: (index) => ed.thumbnails.srcdoc(index) },
  });
}

/** Makes (html, theme) the shown deck: re-parses, re-validates, re-renders the frame and keeps slide and selection where they still exist. */
export function show(ed: Editor, html: string, theme: string): void {
  ed.html = html;
  ed.theme = theme;
  ed.model = parseDeck(html).model;
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
  for (const popover of ed.popovers) popover.refresh();
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

export function changeTheme(ed: Editor, name: string, value: string): void {
  commitEditing(ed);
  try { commitSteps(ed, [], "Change theme", undefined, setThemeProperty(ed.theme, name, value)); } catch (error) { ed.notice = String(error instanceof Error ? error.message : error); renderChrome(ed); }
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

export function deleteSelected(ed: Editor): void {
  commitEdits(ed, selectedBlocks(ed).map((block): DeckEdit => ({ kind: "deleteBlock", block: block.id })), "Delete block");
}

/** A strip edit is one change; the selected slide follows it: the new slide, the moved slide, or the previous one after a delete. */
export function stripEdit(ed: Editor, edit: DeckEdit, label: string): void {
  commitEditing(ed);
  let select: number | undefined;
  if (edit.kind === "addSlide") select = edit.at;
  else if (edit.kind === "duplicateSlide") select = edit.slide + 1;
  else if (edit.kind === "deleteSlide") select = Math.max(0, edit.slide - 1);
  else if (edit.kind === "moveSlide") select = edit.to;
  commitEdits(ed, [edit], label, select);
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

export function createLeaf(ed: () => Editor): LeafEditing {
  return createLeafEditing({
    commit: (block, leaf, text) => commitEdits(ed(), [{ kind: "setText", block, leaf, text }], "Edit text"),
    closed: () => renderChrome(ed()),
    doubleClick: (target) => {
      const block = target.closest("[data-block]")?.getAttribute("data-block");
      if (block) beginEditing(ed(), block, target);
    },
  });
}

