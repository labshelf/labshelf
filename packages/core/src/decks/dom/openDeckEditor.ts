// Deck editor: the slide frame on a stage with a selection overlay, in-place leaf text editing, a toolbar, D8 keys, read-only diagnostics and history.
import { renderElement } from "../../ui/dom/index.js";
import { applyDeckEdit, type DeckEdit } from "../deckEdit.js";
import { parseDeck, type DeckBlock, type DeckModel, type DeckRect } from "../deckParse.js";
import { deckCanvasPx } from "../deckSizes.js";
import { validateDeck, type DeckDiagnostic } from "../deckValidate.js";
import { createDeckHistory, gestureEdit, gestureRect, nudgeEdit, selectBlock, type DeckGesture, type DeckHistory, type DeckSelection, type ResizeHandle } from "../editor/index.js";
import { mountDeckFrame, type DeckFrame, type DeckMathLoader } from "./deckFrame.js";
import { createDeckOverlay, gestureTransform, type DeckOverlay } from "./deckOverlay.js";
import { createLeafEditing, type LeafEditing } from "./leafEditing.js";

export type DeckHistoryMode = "internal" | "host";

export interface DeckEditorChange { html: string; theme: string; label: string }

export interface DeckEditorOptions { html: string; theme: string; resolveAsset(path: string): Promise<string>; loadMath?: DeckMathLoader; assetOrigin?: string; history?: DeckHistoryMode; onChange(change: DeckEditorChange): void; onUndo?: () => void; onRedo?: () => void }

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
  frame: DeckFrame;
  overlay: DeckOverlay;
  buttons: { undo: HTMLButtonElement; redo: HTMLButtonElement; remove: HTMLButtonElement };
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

// ---- rendering ----

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
  const slides = ed.model?.slides.length ?? 0;
  ed.status.textContent = readOnly ? READ_ONLY_STATUS : ed.notice || (slides > 0 ? `Slide ${ed.selection.slide + 1} of ${slides}` : "This deck has no slides.");
  ed.problems.replaceChildren(...ed.errors.map((d) => renderElement("li", { class: "deck-editor-problem", text: `${d.code} line ${d.line}: ${d.message}` })));
  ed.problems.hidden = !readOnly;
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
  if (slide !== ed.frameSlide) void ed.frame.setSlide((ed.frameSlide = slide));
  renderChrome(ed);
}

// ---- changes and history ----

function commitEdits(ed: Editor, edits: DeckEdit[], label: string): void {
  if (isReadOnly(ed) || edits.length === 0) return;
  let html = ed.html;
  for (const edit of edits) {
    const result = applyDeckEdit(html, edit);
    if (!result.ok) {
      ed.notice = result.error;
      renderChrome(ed);
      return;
    }
    html = result.html;
  }
  if (html === ed.html) return;
  ed.history?.push({ html, theme: ed.theme });
  show(ed, html, ed.theme);
  ed.options.onChange({ html, theme: ed.theme, label });
}

function step(ed: Editor, direction: "undo" | "redo"): void {
  if (ed.destroyed) return;
  cancelEditing(ed);
  if (!ed.history) {
    if (direction === "undo") ed.options.onUndo?.();
    else ed.options.onRedo?.();
    return;
  }
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
  const edits = selectedBlocks(ed).map((block): DeckEdit => ({ kind: "deleteBlock", block: block.id }));
  commitEdits(ed, edits, "Delete block");
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

// ---- text editing ----

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

// ---- pointer and keyboard ----

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
  if ("pointerId" in event && typeof captor.setPointerCapture === "function") {
    try {
      captor.setPointerCapture(event.pointerId);
    } catch {
      // capture is a nicety
    }
  }
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

// ---- opening ----

function toolButton(label: string, title: string, action: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost deck-editor-tool", "aria-label": label, title, text: label });
  button.addEventListener("click", action);
  return button;
}

export function openDeckEditor(host: HTMLElement, options: DeckEditorOptions): DeckEditorController {
  const undo = toolButton("Undo", "Undo (Mod+Z)", () => step(ed, "undo"));
  const redo = toolButton("Redo", "Redo (Shift+Mod+Z)", () => step(ed, "redo"));
  const remove = toolButton("Delete block", "Delete the selected blocks (Delete)", () => deleteSelected(ed));
  const toolbar = renderElement("div", { class: "deck-editor-toolbar", role: "toolbar", "aria-label": "Deck" }, undo, redo, renderElement("span", { class: "deck-editor-toolbar-sep", role: "separator" }), remove);
  const stage = renderElement("div", { class: "deck-editor-stage", tabindex: "0", "aria-label": "Slide" });
  const status = renderElement("div", { class: "deck-editor-status", role: "status", "aria-live": "polite" });
  const problems = renderElement("ul", { class: "deck-editor-problems", role: "list", "aria-label": "Deck problems" });
  const root = renderElement("div", { class: "deck-editor" }, toolbar, stage, status, problems);
  host.append(root);
  const frame = mountDeckFrame(stage, { html: options.html, theme: options.theme, slide: 0, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}), ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  frame.frame.classList.add("deck-editor-frame");
  const overlay = createDeckOverlay();
  stage.append(overlay.el);
  const history = options.history === "host" ? null : createDeckHistory({ html: options.html, theme: options.theme });
  const ed: Editor = {
    options, html: options.html, theme: options.theme, model: undefined, errors: [], selection: { slide: 0, blocks: [] }, history,
    drag: null, leaf: createLeaf(() => ed), frameSlide: 0, notice: "", scale: 1, destroyed: false, root, stage, frame, overlay, buttons: { undo, redo, remove }, status, problems,
  };
  ed.model = parseDeck(options.html).model;
  ed.errors = validateDeck(options.html, { theme: options.theme }).filter((d) => d.severity === "error");

  frame.frame.addEventListener("load", () => {
    const doc = frame.frame.contentDocument;
    if (doc) ed.leaf.attach(doc);
  });
  root.addEventListener("pointerdown", (event) => {
    if (!ed.leaf.contains(event.target instanceof Node ? event.target : null)) commitEditing(ed);
  }, true);
  stage.addEventListener("pointerdown", (event) => pressBox(ed, event));
  stage.addEventListener("pointermove", (event) => moveDrag(ed, event));
  stage.addEventListener("pointerup", () => endDrag(ed, true));
  stage.addEventListener("pointercancel", () => endDrag(ed, false));
  stage.addEventListener("dblclick", (event) => {
    const id = event.target instanceof Element ? event.target.closest("[data-block-box]")?.getAttribute("data-block-box") : null;
    if (id) beginEditing(ed, id, null);
  });
  root.addEventListener("keydown", (event) => onKey(ed, event));
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!ed.drag) renderChrome(ed); }) : null;
  resize?.observe(stage);
  renderChrome(ed);

  return {
    element: root,
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
      frame.destroy();
      root.remove();
    },
  };
}
