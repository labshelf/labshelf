// Deck editor: the slide frame on a stage with a selection overlay, in-place leaf text editing, a toolbar, a source view, D8 keys, read-only diagnostics and history.
import { renderElement } from "../../ui/dom/index.js";
import { applyDeckEdit, type DeckEdit, type DeckEditResult } from "../deckEdit.js";
import { parseDeck, type DeckBlock, type DeckModel, type DeckRect } from "../deckParse.js";
import { updateDeckLink, type DeckLinkSources } from "../deckLinks.js";
import { deckCanvasPx } from "../deckSizes.js";
import { setThemeProperty } from "../themeCss.js";
import { validateDeck, type DeckDiagnostic } from "../deckValidate.js";
import { gestureEdit, gestureRect, nudgeEdit, selectBlock, type DeckGesture, type DeckSelection } from "../deckGestures.js";
import { createDeckHistory, type DeckHistory } from "../deckHistory.js";
import type { ResizeHandle } from "../deckSnap.js";
import { mountDeckFrame, type DeckFrame, type DeckMathLoader } from "./deckFrame.js";
import { createDeckOverlay, createLinkBadgeSync, gestureTransform, type DeckOverlay, type LinkBadgeSync } from "./deckOverlay.js";
import { createLeafEditing, type LeafEditing } from "./leafEditing.js";
import { createSizePopover } from "./sizePicker.js";
import { createDeckSourceToggle, type DeckSourceToggle } from "./deckSourceView.js";
import { mountSlideStrip, type SlideStrip } from "./slideStrip.js";
import { createDeckThumbnails, type DeckThumbnails } from "./slideThumbnails.js";
import { createThemePopover, createToolButton, type ToolbarPopover } from "./themePanel.js";
export * from "./index.js";

export type DeckHistoryMode = "internal" | "host";

export interface DeckEditorChange { html: string; theme: string; label: string }

export interface DeckEditorOptions { html: string; theme: string; resolveAsset(path: string): Promise<string>; loadMath?: DeckMathLoader; assetOrigin?: string; linkSources?: DeckLinkSources; history?: DeckHistoryMode; onChange(change: DeckEditorChange): void; onUndo?: () => void; onRedo?: () => void }

export interface DeckEditorController { readonly element: HTMLElement; setDocument(html: string, theme: string): void; selectSlide(index: number): void; currentSlide(): number; undo(): void; redo(): void; destroy(): void }

const READ_ONLY_STATUS = "This deck has errors and opens read-only.";
const DEFAULT_CANVAS = { width: 1920, height: 1080 };

interface Drag { gesture: DeckGesture; others: DeckRect[]; rect: DeckRect | null }

interface Editor {
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
  destroyed: boolean;
  root: HTMLElement;
  stage: HTMLElement;
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

const isReadOnly = (ed: Editor): boolean => ed.errors.length > 0;
const slideBlocks = (ed: Editor): DeckBlock[] => ed.model?.slides[ed.selection.slide]?.blocks ?? [];
const canvasOf = (ed: Editor): { width: number; height: number } => (ed.model?.size ? deckCanvasPx(ed.model.size) : DEFAULT_CANVAS);
const findBlock = (ed: Editor, id: string): DeckBlock | undefined => slideBlocks(ed).find((block) => block.id === id);
const selectedBlocks = (ed: Editor): Array<DeckBlock & { rect: DeckRect }> =>
  slideBlocks(ed).filter((block): block is DeckBlock & { rect: DeckRect } => block.rect !== null && ed.selection.blocks.includes(block.id));

function frameBlock(ed: Editor, id: string): HTMLElement | null {
  const doc = ed.frame.frame.contentDocument;
  return Array.from(doc?.querySelectorAll<HTMLElement>("[data-block]") ?? []).find((element) => element.getAttribute("data-block") === id) ?? null;
}

const usesMeta = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Lays out the stage (scale, frame size) and redraws the overlay, toolbar, status line and problems list. */
function renderChrome(ed: Editor): void {
  if (ed.destroyed) return;
  const canvas = canvasOf(ed);
  const width = ed.stage.clientWidth;
  ed.scale = width > 0 ? width / canvas.width : 1;
  ed.frame.frame.style.width = `${canvas.width}px`;
  ed.frame.frame.style.height = `${canvas.height}px`;
  ed.stage.style.setProperty("--deck-editor-scale", String(ed.scale));
  ed.stage.style.height = `${canvas.height * ed.scale}px`;
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
  syncStrip(ed, slides);
}

/** The strip shows for a talk that opens for editing; a poster has one slide. */
function syncStrip(ed: Editor, slides: number): void {
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
function show(ed: Editor, html: string, theme: string): void {
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

const commitEdits = (ed: Editor, edits: DeckEdit[], label: string, select?: number): void => commitSteps(ed, edits.map((edit) => (html: string) => applyDeckEdit(html, edit)), label, select);

/** One change from steps applied in order to the html (and an optional new theme): shown, pushed to history and handed to the host; a failing step shows its error. */
function commitSteps(ed: Editor, steps: Array<(html: string) => DeckEditResult>, label: string, select?: number, theme = ed.theme): void {
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
function record(ed: Editor, html: string, theme: string, label: string): void {
  ed.history?.push({ html, theme });
  show(ed, html, theme);
  ed.options.onChange({ html, theme, label });
}

function changeTheme(ed: Editor, name: string, value: string): void {
  commitEditing(ed);
  try { commitSteps(ed, [], "Change theme", undefined, setThemeProperty(ed.theme, name, value)); } catch (error) { ed.notice = String(error instanceof Error ? error.message : error); renderChrome(ed); }
}

function step(ed: Editor, direction: "undo" | "redo"): void {
  if (ed.destroyed) return;
  cancelEditing(ed);
  if (!ed.history) return void (direction === "undo" ? ed.options.onUndo?.() : ed.options.onRedo?.());
  const snapshot = direction === "undo" ? ed.history.undo() : ed.history.redo();
  if (!snapshot) return;
  show(ed, snapshot.html, snapshot.theme);
  ed.options.onChange({ html: snapshot.html, theme: snapshot.theme, label: direction === "undo" ? "Undo" : "Redo" });
}

function setSelection(ed: Editor, selection: DeckSelection): void {
  ed.selection = selection;
  renderChrome(ed);
}

function deleteSelected(ed: Editor): void {
  commitEdits(ed, selectedBlocks(ed).map((block): DeckEdit => ({ kind: "deleteBlock", block: block.id })), "Delete block");
}

/** A strip edit is one change; the selected slide follows it: the new slide, the moved slide, or the previous one after a delete. */
function stripEdit(ed: Editor, edit: DeckEdit, label: string): void {
  commitEditing(ed);
  let select: number | undefined;
  if (edit.kind === "addSlide") select = edit.at;
  else if (edit.kind === "duplicateSlide") select = edit.slide + 1;
  else if (edit.kind === "deleteSlide") select = Math.max(0, edit.slide - 1);
  else if (edit.kind === "moveSlide") select = edit.to;
  commitEdits(ed, [edit], label, select);
}

function selectSlide(ed: Editor, index: number): void {
  const slides = ed.model?.slides.length ?? 0;
  if (slides === 0) return;
  const slide = Math.max(0, Math.min(Math.trunc(index), slides - 1));
  if (slide === ed.selection.slide) return;
  commitEditing(ed);
  ed.selection = { slide, blocks: [] };
  void ed.frame.setSlide((ed.frameSlide = slide));
  renderChrome(ed);
}

function beginEditing(ed: Editor, block: string, target: Element | null): void {
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

const commitEditing = (ed: Editor): void => ed.leaf.commit();
const cancelEditing = (ed: Editor): void => ed.leaf.cancel();

function createLeaf(ed: () => Editor): LeafEditing {
  return createLeafEditing({
    commit: (block, leaf, text) => commitEdits(ed(), [{ kind: "setText", block, leaf, text }], "Edit text"),
    closed: () => renderChrome(ed()),
    doubleClick: (target) => {
      const block = target.closest("[data-block]")?.getAttribute("data-block");
      if (block) beginEditing(ed(), block, target);
    },
  });
}

function pressBox(ed: Editor, event: PointerEvent): void {
  if (event.button !== 0 || isReadOnly(ed) || ed.destroyed) return;
  const target = event.target instanceof Element ? event.target : null;
  const boxEl = target?.closest<HTMLElement>("[data-block-box]");
  if (!boxEl) {
    if (ed.selection.blocks.length > 0) setSelection(ed, selectBlock(ed.selection, null, false));
    return;
  }
  const id = boxEl.getAttribute("data-block-box")!;
  const block = findBlock(ed, id);
  if (!block?.rect) return;
  const handle = target?.closest<HTMLElement>("[data-handle]")?.getAttribute("data-handle") as ResizeHandle | null | undefined;
  event.preventDefault();
  boxEl.focus({ preventScroll: true });
  if (!handle) {
    setSelection(ed, selectBlock(ed.selection, id, event.shiftKey));
    // A Shift press on a selected box takes it out of the selection and starts no gesture.
    if (!ed.selection.blocks.includes(id)) return;
  }
  const captor = target ?? boxEl;
  if ("pointerId" in event && typeof captor.setPointerCapture === "function") try { captor.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
  const others = slideBlocks(ed).flatMap((other) => (other.id !== id && other.rect ? [other.rect] : []));
  ed.drag = { gesture: { kind: handle ? "resize" : "move", block: id, ...(handle ? { handle } : {}), start: block.rect, origin: { x: event.clientX, y: event.clientY } }, others, rect: null };
}

function setDragTransform(ed: Editor, drag: Drag, rect: DeckRect | null): void {
  ed.root.classList.toggle("is-dragging", rect !== null);
  const box = ed.overlay.box(drag.gesture.block);
  const element = frameBlock(ed, drag.gesture.block);
  const { start } = drag.gesture;
  if (box) box.style.transform = rect ? gestureTransform(start, rect, ed.scale) : "";
  if (element) element.style.transform = rect ? gestureTransform(start, rect, 1) : "";
}

function moveDrag(ed: Editor, event: PointerEvent): void {
  const drag = ed.drag;
  if (!drag) return;
  const result = gestureRect(drag.gesture, { x: event.clientX, y: event.clientY }, { scale: ed.scale, snap: { others: drag.others, canvas: canvasOf(ed), disabled: event.altKey } });
  drag.rect = result.rect;
  setDragTransform(ed, drag, result.rect);
  ed.overlay.showGuides(result.guides, ed.scale);
}

function endDrag(ed: Editor, apply: boolean): void {
  const drag = ed.drag;
  if (!drag) return;
  ed.drag = null;
  setDragTransform(ed, drag, null);
  ed.overlay.clearGuides();
  const edit = apply && drag.rect ? gestureEdit(drag.gesture, drag.rect) : null;
  if (edit) commitEdits(ed, [edit], drag.gesture.kind === "move" ? "Move block" : "Resize block");
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function onKey(ed: Editor, event: KeyboardEvent): void {
  if (isReadOnly(ed) || ed.leaf.block() !== null || ed.drag || ed.destroyed) return;
  const lower = event.key.toLowerCase();
  if (usesMeta() ? event.metaKey : event.ctrlKey) {
    if (lower !== "z" && lower !== "y") return;
    event.preventDefault();
    step(ed, event.shiftKey || lower === "y" ? "redo" : "undo");
    return;
  }
  if (!(event.target instanceof Node) || !ed.stage.contains(event.target)) return;
  const arrow = ARROWS[event.key];
  const selected = selectedBlocks(ed);
  if (arrow) {
    if (selected.length === 0) return;
    const distance = event.shiftKey ? 10 : 1;
    event.preventDefault();
    commitEdits(ed, selected.map((block) => nudgeEdit(block.id, block.rect, arrow[0] * distance, arrow[1] * distance)), "Move block");
  } else if (event.key === "Delete" || event.key === "Backspace") {
    if (selected.length === 0) return;
    event.preventDefault();
    deleteSelected(ed);
  } else if (event.key === "Escape") {
    if (ed.selection.blocks.length === 0) return;
    event.preventDefault();
    setSelection(ed, selectBlock(ed.selection, null, false));
  } else if (event.key === "Enter") {
    if (ed.selection.blocks.length !== 1) return;
    event.preventDefault();
    beginEditing(ed, ed.selection.blocks[0]!, null);
  } else if (event.key === "PageDown" || event.key === "PageUp") {
    event.preventDefault();
    selectSlide(ed, ed.selection.slide + (event.key === "PageDown" ? 1 : -1));
  }
}

export function openDeckEditor(host: HTMLElement, options: DeckEditorOptions): DeckEditorController {
  const undo = createToolButton("Undo", "Undo (Mod+Z)", () => step(ed, "undo"));
  const redo = createToolButton("Redo", "Redo (Shift+Mod+Z)", () => step(ed, "redo"));
  const remove = createToolButton("Delete block", "Delete the selected blocks (Delete)", () => deleteSelected(ed));
  const themePop = createThemePopover({ theme: () => ed.theme, onChange: (name, value) => changeTheme(ed, name, value) });
  const sizePop = createSizePopover({ current: () => ed.model, onApply: (size) => commitEdits(ed, [{ kind: "setSize", size, scale: true }], "Change size") });
  const stage = renderElement("div", { class: "deck-editor-stage", tabindex: "0", "aria-label": "Slide" });
  const status = renderElement("div", { class: "deck-editor-status", role: "status", "aria-live": "polite" });
  const problems = renderElement("ul", { class: "deck-editor-problems", role: "list", "aria-label": "Deck problems" });
  const body = renderElement("div", { class: "deck-editor-body" }, stage);
  const source = createDeckSourceToggle({ container: body, stage, html: () => ed.html, beforeToggle: () => commitEditing(ed), toggled: () => renderChrome(ed), onDeck: (html) => record(ed, html, ed.theme, "Edit source"), onProblem: (notice) => { ed.notice = notice; renderChrome(ed); } });
  const toolbar = renderElement("div", { class: "deck-editor-toolbar", role: "toolbar", "aria-label": "Deck" }, undo, redo, renderElement("span", { class: "deck-editor-toolbar-sep", role: "separator" }), remove, renderElement("span", { class: "deck-editor-toolbar-sep", role: "separator" }), themePop.element, sizePop.element, source.button);
  const root = renderElement("div", { class: "deck-editor" }, toolbar, body, status, problems);
  host.append(root);
  const frame = mountDeckFrame(stage, { html: options.html, theme: options.theme, slide: 0, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}), ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  frame.frame.classList.add("deck-editor-frame");
  const overlay = createDeckOverlay();
  stage.append(overlay.el);
  const thumbnails = createDeckThumbnails({ deck: () => ({ html: ed.html, theme: ed.theme, canvas: canvasOf(ed) }), resolveAsset: options.resolveAsset, ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  const ed: Editor = {
    options, html: options.html, theme: options.theme, model: parseDeck(options.html).model, errors: validateDeck(options.html, { theme: options.theme }).filter((d) => d.severity === "error"), selection: { slide: 0, blocks: [] },
    history: options.history === "host" ? null : createDeckHistory({ html: options.html, theme: options.theme }), drag: null, leaf: createLeaf(() => ed), frameSlide: 0, notice: "", scale: 1, destroyed: false, root, stage, body, strip: null, thumbnails, frame, overlay, buttons: { undo, redo, remove }, popovers: [themePop, sizePop], badges: null, source, status, problems,
  };
  if (options.linkSources) ed.badges = createLinkBadgeSync({ sources: options.linkSources, box: (block) => ed.overlay.box(block), onUpdate: (block, { hash, text }) => { if (hash) commitSteps(ed, [(html) => updateDeckLink(html, block, hash, text)], "Update linked block"); } });
  const resize = bindEditorEvents(ed);
  renderChrome(ed);
  return editorController(ed, resize);
}

/** Wires the frame, stage, keys and stage resizes to the editor; returns the resize observer to disconnect on destroy. */
function bindEditorEvents(ed: Editor): ResizeObserver | null {
  const { frame, root, stage } = ed;
  frame.frame.addEventListener("load", () => { const doc = frame.frame.contentDocument; if (doc) ed.leaf.attach(doc); });
  root.addEventListener("pointerdown", (event) => { if (!ed.leaf.contains(event.target instanceof Node ? event.target : null)) commitEditing(ed); }, true);
  stage.addEventListener("pointerdown", (event) => pressBox(ed, event));
  stage.addEventListener("pointermove", (event) => moveDrag(ed, event));
  stage.addEventListener("pointerup", () => endDrag(ed, true));
  stage.addEventListener("pointercancel", () => endDrag(ed, false));
  const boxId = (target: EventTarget | null): string | null | undefined => (target instanceof Element ? target.closest("[data-block-box]")?.getAttribute("data-block-box") : null);
  stage.addEventListener("dblclick", (event) => { const id = boxId(event.target); if (id) beginEditing(ed, id, null); });
  root.addEventListener("keydown", (event) => onKey(ed, event));
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!ed.drag) renderChrome(ed); }) : null;
  resize?.observe(stage);
  return resize;
}

function editorController(ed: Editor, resize: ResizeObserver | null): DeckEditorController {
  return {
    element: ed.root,
    setDocument(html, theme) {
      if (ed.destroyed || (html === ed.html && theme === ed.theme)) return;
      cancelEditing(ed);
      endDrag(ed, false);
      ed.history?.reset({ html, theme });
      show(ed, html, theme);
    },
    selectSlide: (index) => selectSlide(ed, index),
    currentSlide: () => ed.selection.slide,
    undo: () => step(ed, "undo"),
    redo: () => step(ed, "redo"),
    destroy() {
      if (ed.destroyed) return;
      ed.destroyed = true;
      resize?.disconnect();
      ed.strip?.destroy();
      ed.badges?.destroy();
      ed.source.destroy();
      for (const popover of ed.popovers) popover.destroy();
      ed.frame.destroy();
      ed.root.remove();
    },
  };
}
