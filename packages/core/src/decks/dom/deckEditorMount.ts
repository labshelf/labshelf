// Mounts the deck editor: the slide frame on a zoomable stage in a scrolling viewport, with a selection overlay, in-place leaf text
// editing, a source view, the stage's own keys, read-only diagnostics and history; the deck shell (shell/html/) surrounds it.
import { renderElement } from "../../ui/dom/index.js";
import { parseDeck } from "../deckParse.js";
import { updateDeckLink } from "../deckLinks.js";
import { validateDeck } from "../deckValidate.js";
import { createDeckHistory } from "../deckHistory.js";
import { mountDeckFrame } from "./deckFrame.js";
import { createDeckOverlay, createLinkBadgeSync } from "./deckOverlay.js";
import { createDeckSourceToggle } from "./deckSourceView.js";
import {
  beginEditing, cancelEditing, changeThemeCss, previewThemeCss, commitEditing, commitSteps, createLeaf, leafFormatting, onLinkRequest, record, renderChrome, setSelection, selectSlide, show, step,
  type DeckEditorController, type DeckEditorOptions, type Editor,
} from "./deckEditorCore.js";
import { bindEditorEvents } from "./deckEditorInput.js";
import { endDrag } from "./deckEditorMulti.js";
export function openDeckEditor(host: HTMLElement, options: DeckEditorOptions): DeckEditorController {
  const stage = renderElement("div", { class: "deck-editor-stage", tabindex: "0", "aria-label": "Slide" });
  const viewport = renderElement("div", { class: "deck-editor-viewport" }, stage);
  const body = renderElement("div", { class: "deck-editor-body" }, viewport);
  // The source toggle's button is never shown: the shell's Code tab presses it through toggleSource.
  const source = createDeckSourceToggle({ container: body, stage: viewport, html: () => ed.html, beforeToggle: () => commitEditing(ed), toggled: () => renderChrome(ed), onDeck: (html) => record(ed, html, ed.theme, "Edit source"), onProblem: (notice) => { ed.notice = notice; renderChrome(ed); } });
  const root = renderElement("div", { class: "deck-editor deck-editor-bare" }, body);
  host.append(root);
  const frame = mountDeckFrame(stage, { html: options.html, theme: options.theme, slide: 0, resolveAsset: options.resolveAsset, ...(options.loadMath ? { loadMath: options.loadMath } : {}), ...(options.assetOrigin ? { assetOrigin: options.assetOrigin } : {}) });
  frame.frame.classList.add("deck-editor-frame");
  const overlay = createDeckOverlay();
  stage.append(overlay.el);
  const ed: Editor = {
    options, html: options.html, theme: options.theme, model: parseDeck(options.html).model, errors: validateDeck(options.html, { theme: options.theme }).filter((d) => d.severity === "error"), selection: { slide: 0, blocks: [] },
    history: options.history === "host" ? null : createDeckHistory({ html: options.html, theme: options.theme }), drag: null, leaf: createLeaf(() => ed), frameSlide: 0, notice: "", scale: 1, zoom: "fit", tool: "select", destroyed: false, root, stage, viewport, frame, overlay, badges: null, source,
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
    editThemeCss: (css, label) => changeThemeCss(ed, css, label),
    previewThemeCss: (css) => previewThemeCss(ed, css),
    setZoom(zoom) { ed.zoom = zoom; renderChrome(ed); },
    setTool(tool) { ed.tool = tool; ed.root.classList.toggle("is-hand", tool === "hand"); },
    leafFormatting: () => leafFormatting(ed),
    onLinkRequest: (listener) => onLinkRequest(ed, listener),
    toggleSource() { ed.source.button.click(); return ed.source.button.getAttribute("aria-pressed") === "true"; },
    destroy() {
      if (ed.destroyed) return;
      ed.destroyed = true;
      resize?.disconnect();
      ed.badges?.destroy();
      ed.source.destroy();
      ed.frame.destroy();
      ed.root.remove();
    },
  };
}
