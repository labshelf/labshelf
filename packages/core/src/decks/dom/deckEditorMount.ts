// Mounts the deck editor: the slide frame on a stage with a selection overlay, in-place leaf text editing, a toolbar, a source view,
// D8 keys, read-only diagnostics and history; bare, only the zoomable stage for the deck workspace (deckShell/) to surround.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck } from "../deckParse.js";
import { updateDeckLink } from "../deckLinks.js";
import { validateDeck } from "../deckValidate.js";
import { createDeckHistory } from "../deckHistory.js";
import { mountDeckFrame } from "./deckFrame.js";
import { createDeckOverlay, createLinkBadgeSync } from "./deckOverlay.js";
import { createSizePopover } from "./sizePicker.js";
import { createDeckSourceToggle } from "./deckSourceView.js";
import { createDeckThumbnails } from "./slideThumbnails.js";
import { createThemePopover, createToolButton } from "./themePanel.js";
import {
  beginEditing, cancelEditing, canvasOf, changeTheme, commitEditing, commitEdits, commitSteps, createLeaf, deleteSelected, record, renderChrome, setSelection, selectSlide, show, step,
  type DeckEditorController, type DeckEditorOptions, type Editor,
} from "./deckEditorCore.js";
import { bindEditorEvents, endDrag } from "./deckEditorInput.js";
export function openDeckEditor(host: HTMLElement, options: DeckEditorOptions): DeckEditorController {
  const undo = createToolButton("Undo", "Undo (Mod+Z)", () => step(ed, "undo"));
  const redo = createToolButton("Redo", "Redo (Shift+Mod+Z)", () => step(ed, "redo"));
  const remove = createToolButton("Delete block", "Delete the selected blocks (Delete)", () => deleteSelected(ed));
  const themePop = createThemePopover({ theme: () => ed.theme, onChange: (name, value) => changeTheme(ed, name, value) });
  const sizePop = createSizePopover({ current: () => ed.model, onApply: (size) => commitEdits(ed, [{ kind: "setSize", size, scale: true }], "Change size") });
  const stage = renderElement("div", { class: "deck-editor-stage", tabindex: "0", "aria-label": "Slide" });
  const status = renderElement("div", { class: "deck-editor-status", role: "status", "aria-live": "polite" });
  const problems = renderElement("ul", { class: "deck-editor-problems", role: "list", "aria-label": "Deck problems" });
  const viewport = options.bare ? renderElement("div", { class: "deck-editor-viewport" }, stage) : stage;
  const body = renderElement("div", { class: "deck-editor-body" }, viewport);
  const source = createDeckSourceToggle({ container: body, stage: viewport, html: () => ed.html, beforeToggle: () => commitEditing(ed), toggled: () => renderChrome(ed), onDeck: (html) => record(ed, html, ed.theme, "Edit source"), onProblem: (notice) => { ed.notice = notice; renderChrome(ed); } });
  const toolbar = renderElement("div", { class: "deck-editor-toolbar", role: "toolbar", "aria-label": "Deck" }, undo, redo, renderElement("span", { class: "deck-editor-toolbar-sep", role: "separator" }), remove, renderElement("span", { class: "deck-editor-toolbar-sep", role: "separator" }), themePop.element, sizePop.element, source.button);
  const root = options.bare ? renderElement("div", { class: "deck-editor deck-editor-bare" }, body) : renderElement("div", { class: "deck-editor" }, toolbar, body, status, problems);
  host.append(root);
  const frame = mountDeckFrame(stage, { html: options.html, theme: options.theme, slide: 0, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}), ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  frame.frame.classList.add("deck-editor-frame");
  const overlay = createDeckOverlay();
  stage.append(overlay.el);
  const thumbnails = createDeckThumbnails({ deck: () => ({ html: ed.html, theme: ed.theme, canvas: canvasOf(ed) }), resolveAsset: options.resolveAsset, ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  const ed: Editor = {
    options, html: options.html, theme: options.theme, model: parseDeck(options.html).model, errors: validateDeck(options.html, { theme: options.theme }).filter((d) => d.severity === "error"), selection: { slide: 0, blocks: [] },
    history: options.history === "host" ? null : createDeckHistory({ html: options.html, theme: options.theme }), drag: null, leaf: createLeaf(() => ed), frameSlide: 0, notice: "", scale: 1, zoom: "fit", tool: "select", destroyed: false, root, stage, viewport, body, strip: null, thumbnails, frame, overlay, buttons: { undo, redo, remove }, popovers: [themePop, sizePop], badges: null, source, status, problems,
  };
  if (options.linkSources) ed.badges = createLinkBadgeSync({ sources: options.linkSources, box: (block) => ed.overlay.box(block), onUpdate: (block, { hash, text }) => { if (hash) commitSteps(ed, [(html) => updateDeckLink(html, block, hash, text)], "Update linked block"); } });
  const resize = bindEditorEvents(ed);
  renderChrome(ed);
  return editorController(ed, resize);
}

function editorController(ed: Editor, resize: ResizeObserver | null): DeckEditorController {
  return {
    element: ed.root,
    stage: ed.stage,
    viewport: ed.viewport,
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
    edit: (steps, label) => commitSteps(ed, steps, label),
    selectBlocks: (ids) => { commitEditing(ed); setSelection(ed, { slide: ed.selection.slide, blocks: [...ids] }); },
    editText: (block) => beginEditing(ed, block, null),
    editTheme: (name, value) => changeTheme(ed, name, value),
    setZoom(zoom) { ed.zoom = zoom; renderChrome(ed); },
    setTool(tool) { ed.tool = tool; ed.root.classList.toggle("is-hand", tool === "hand"); },
    toggleSource() { ed.source.button.click(); return ed.source.button.getAttribute("aria-pressed") === "true"; },
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
